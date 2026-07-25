import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { makeNetwork, makeUser, resetDb, testDb } from '../testing/db'
import { DEFAULT_SETTINGS } from '../config/settings'
import { FraudPipeline } from './pipeline'
import type { CheckOutcome, FraudCheck, FraudContext, FraudSubject } from './types'

const db: Database = testDb()

const ctxWith = (overrides: Partial<typeof DEFAULT_SETTINGS> = {}): FraudContext => ({
  db,
  settings: { ...DEFAULT_SETTINGS, ...overrides },
  configVersion: 1,
  log: () => {},
})

/** A check with a fixed verdict, for exercising the pipeline's own decisions. */
const fixed = (key: string, outcome: CheckOutcome): FraudCheck => ({
  key,
  appliesTo: ['signup', 'login', 'completion', 'payout'],
  evaluate: async () => outcome,
})

const signup = (userId: string): FraudSubject => ({
  type: 'signup',
  userId,
  email: 'x@test.local',
  ip: '203.0.113.9',
})

beforeEach(async () => {
  await resetDb(db)
})

afterAll(async () => {
  await resetDb(db)
})

describe('scoring', () => {
  it('allows when nothing is suspicious', async () => {
    const userId = await makeUser(db)
    const pipeline = new FraudPipeline([fixed('a', { verdict: 'allow', scoreDelta: 0 })])

    const result = await pipeline.evaluate(signup(userId), ctxWith())
    expect(result.verdict).toBe('allow')
    expect(result.score).toBe(0)
  })

  it('accumulates across checks rather than taking the worst', async () => {
    const userId = await makeUser(db)
    // Individually harmless, collectively not. A pipeline that took the max
    // rather than the sum would let this through.
    const pipeline = new FraudPipeline([
      fixed('a', { verdict: 'allow', scoreDelta: 20 }),
      fixed('b', { verdict: 'allow', scoreDelta: 20 }),
      fixed('c', { verdict: 'allow', scoreDelta: 15 }),
    ])

    const result = await pipeline.evaluate(signup(userId), ctxWith({ fraud_review_score: 50 }))
    expect(result.score).toBe(55)
    expect(result.verdict).toBe('review')
  })

  it('denies at the deny threshold', async () => {
    const userId = await makeUser(db)
    const pipeline = new FraudPipeline([fixed('a', { verdict: 'allow', scoreDelta: 95 })])

    const result = await pipeline.evaluate(
      signup(userId),
      ctxWith({ fraud_review_score: 50, fraud_deny_score: 90 }),
    )
    expect(result.verdict).toBe('deny')
  })

  it('lets a single conclusive check deny outright, whatever the score', async () => {
    const userId = await makeUser(db)
    // A payout destination shared with three other accounts is conclusive on
    // its own and must not be diluted by an averaged or summed score.
    const pipeline = new FraudPipeline([fixed('conclusive', { verdict: 'deny', scoreDelta: 0 })])

    const result = await pipeline.evaluate(signup(userId), ctxWith({ fraud_deny_score: 1000 }))
    expect(result.verdict).toBe('deny')
    expect(result.score).toBe(0)
  })
})

describe('degraded checks', () => {
  it('does not treat a thrown check as a pass', async () => {
    const userId = await makeUser(db)
    const exploding: FraudCheck = {
      key: 'exploding',
      appliesTo: ['signup'],
      evaluate: async () => {
        throw new Error('provider exploded')
      },
    }

    const result = await pipelineFor([exploding]).evaluate(
      signup(userId),
      ctxWith({ fraud_fail_mode: 'closed' }),
    )

    expect(result.verdict).toBe('review')
    const failed = result.results.find((r) => r.checkKey === 'exploding')
    expect(failed?.verdict).toBe('unavailable')
    expect(failed?.error).toMatch(/provider exploded/)
  })

  it('lets a thrown check through when the fail mode is open', async () => {
    const userId = await makeUser(db)
    const exploding: FraudCheck = {
      key: 'exploding',
      appliesTo: ['signup'],
      evaluate: async () => {
        throw new Error('provider exploded')
      },
    }

    const result = await pipelineFor([exploding]).evaluate(
      signup(userId),
      ctxWith({ fraud_fail_mode: 'open' }),
    )
    expect(result.verdict).toBe('allow')
  })

  it('does not flag every event just because a provider is unconfigured', async () => {
    const userId = await makeUser(db)
    // The distinction that matters: a check honestly reporting "I have no
    // account to call" is not the same as one that errored. Treating them
    // alike would send every single event to review until an IPQS account
    // exists, which is how a fraud queue becomes useless on day one.
    const unconfigured = fixed('no_provider', { verdict: 'unavailable', scoreDelta: 0 })

    const result = await pipelineFor([unconfigured]).evaluate(
      signup(userId),
      ctxWith({ fraud_fail_mode: 'closed' }),
    )
    expect(result.verdict).toBe('allow')
  })

  it('times out a hanging check instead of blocking the pipeline', async () => {
    const userId = await makeUser(db)
    const hanging: FraudCheck = {
      key: 'hanging',
      appliesTo: ['signup'],
      timeoutMs: 100,
      evaluate: () => new Promise(() => {}),
    }

    const started = Date.now()
    const result = await pipelineFor([hanging]).evaluate(
      signup(userId),
      ctxWith({ fraud_fail_mode: 'open' }),
    )
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(2_000)
    expect(result.results[0]!.verdict).toBe('unavailable')
    expect(result.results[0]!.error).toMatch(/timed out/)
  })

  it('runs checks concurrently, not one after another', async () => {
    const userId = await makeUser(db)
    const slow = (key: string): FraudCheck => ({
      key,
      appliesTo: ['signup'],
      evaluate: async () => {
        await new Promise((r) => setTimeout(r, 200))
        return { verdict: 'allow', scoreDelta: 0 }
      },
    })

    const started = Date.now()
    await pipelineFor([slow('a'), slow('b'), slow('c'), slow('d')]).evaluate(
      signup(userId),
      ctxWith(),
    )
    const elapsed = Date.now() - started

    // Sequential would be ~800ms. A postback cannot afford that.
    expect(elapsed).toBeLessThan(600)
  })
})

describe('persistence', () => {
  it('records the evaluation and every check result', async () => {
    const userId = await makeUser(db)
    const pipeline = pipelineFor([
      fixed('a', { verdict: 'allow', scoreDelta: 10, details: { seen: 3 } }),
      fixed('b', { verdict: 'review', scoreDelta: 45 }),
    ])

    const result = await pipeline.evaluate(signup(userId), ctxWith({ fraud_review_score: 50 }))

    const evaluations = (await db.execute(sql`
      SELECT verdict::TEXT AS verdict, score::TEXT AS score, config_version::TEXT AS cv
      FROM fraud_evaluations WHERE id = ${result.evaluationId}
    `)) as unknown as Record<string, string>[]
    expect(evaluations[0]!.verdict).toBe('review')
    expect(Number(evaluations[0]!.score)).toBe(55)
    // Stamped so a threshold change later does not make history unreadable.
    expect(Number(evaluations[0]!.cv)).toBe(1)

    const checks = (await db.execute(sql`
      SELECT check_key, verdict::TEXT AS verdict, score_delta::TEXT AS delta, details
      FROM fraud_check_results WHERE evaluation_id = ${result.evaluationId} ORDER BY check_key
    `)) as unknown as Record<string, unknown>[]
    expect(checks).toHaveLength(2)
    expect(checks[0]!.details).toEqual({ seen: 3 })
  })

  it('opens a review item for anything not allowed, and none for allowed', async () => {
    const clean = await makeUser(db)
    await pipelineFor([fixed('a', { verdict: 'allow', scoreDelta: 0 })]).evaluate(
      signup(clean),
      ctxWith(),
    )

    const flagged = await makeUser(db)
    await pipelineFor([fixed('a', { verdict: 'review', scoreDelta: 60 })]).evaluate(
      signup(flagged),
      ctxWith(),
    )

    const rows = (await db.execute(sql`
      SELECT user_id::TEXT AS u, reason, priority::TEXT AS p FROM review_items
    `)) as unknown as Record<string, string>[]

    expect(rows).toHaveLength(1)
    expect(rows[0]!.u).toBe(flagged)
    // The reason names the contributing check, so the queue is triageable
    // without opening every row.
    expect(rows[0]!.reason).toContain('a(')
  })

  it('prioritises payout reviews above completion reviews', async () => {
    const userId = await makeUser(db)
    const networkId = await makeNetwork(db)
    const pipeline = pipelineFor([fixed('a', { verdict: 'review', scoreDelta: 55 })])

    await pipeline.evaluate(
      {
        type: 'completion',
        completionId: crypto.randomUUID(),
        userId,
        networkId,
        grossUsdMicros: 1000,
        pointsAwarded: 10,
      },
      ctxWith(),
    )
    await pipeline.evaluate(
      {
        type: 'payout',
        payoutId: crypto.randomUUID(),
        userId,
        points: 5000,
        destinationHash: 'hash',
      },
      ctxWith(),
    )

    const rows = (await db.execute(sql`
      SELECT subject_type::TEXT AS t, priority::TEXT AS p
      FROM review_items ORDER BY priority DESC
    `)) as unknown as Record<string, string>[]

    // Payouts sort first because that is where money actually leaves.
    expect(rows[0]!.t).toBe('payout')
    expect(Number(rows[0]!.p)).toBeGreaterThan(Number(rows[1]!.p))
  })

  it('only runs checks that apply to the subject type', async () => {
    const userId = await makeUser(db)
    const payoutOnly: FraudCheck = {
      key: 'payout_only',
      appliesTo: ['payout'],
      evaluate: async () => ({ verdict: 'deny', scoreDelta: 100 }),
    }

    const result = await pipelineFor([payoutOnly]).evaluate(signup(userId), ctxWith())
    expect(result.results).toHaveLength(0)
    expect(result.verdict).toBe('allow')
  })
})

function pipelineFor(checks: FraudCheck[]) {
  return new FraudPipeline(checks)
}
