import { fraudCheckResults, fraudEvaluations, reviewItems } from '@app/db/schema'
import { DEFAULT_CHECKS } from './checks'
import type {
  EvaluationResult,
  FraudCheck,
  FraudContext,
  FraudSubject,
  FraudVerdict,
} from './types'

/**
 * Runs every applicable check, accumulates a score, and turns it into one of
 * three outcomes.
 *
 * Design notes that matter:
 *
 * - Checks run CONCURRENTLY and are individually timed out. One slow rule must
 *   not stall a postback, and one throwing rule must not lose a credit.
 *
 * - A check that errors or reports `unavailable` does not silently become
 *   `allow`. It resolves through `fraud_fail_mode`, which is a risk-appetite
 *   setting rather than a technical default. Fail-closed keeps fraud out
 *   during a provider outage and floods the review queue when a rule has a
 *   bug; fail-open does the reverse. Neither is free.
 *
 * - Nothing here writes to the ledger or bans anyone. The pipeline forms an
 *   opinion; the caller applies it. That is what makes it testable in
 *   isolation and re-runnable against history.
 */
export class FraudPipeline {
  private readonly checks: FraudCheck[]

  constructor(checks: FraudCheck[] = DEFAULT_CHECKS) {
    this.checks = checks
  }

  async evaluate(subject: FraudSubject, ctx: FraudContext): Promise<EvaluationResult> {
    const started = Date.now()
    const applicable = this.checks.filter((c) => c.appliesTo.includes(subject.type))

    const results = await Promise.all(
      applicable.map(async (check) => {
        const checkStarted = Date.now()
        try {
          const outcome = await withTimeout(
            check.evaluate(subject, ctx),
            check.timeoutMs ?? 5_000,
            check.key,
          )
          return {
            checkKey: check.key,
            verdict: outcome.verdict,
            scoreDelta: outcome.scoreDelta,
            details: outcome.details,
            durationMs: Date.now() - checkStarted,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.log(`fraud check ${check.key} failed`, { error: message })
          return {
            checkKey: check.key,
            verdict: 'unavailable' as FraudVerdict,
            scoreDelta: 0,
            durationMs: Date.now() - checkStarted,
            error: message,
          }
        }
      }),
    )

    const score = results.reduce((sum, r) => sum + r.scoreDelta, 0)
    const verdict = this.decide(score, results, ctx)
    const durationMs = Date.now() - started

    const [evaluation] = await ctx.db
      .insert(fraudEvaluations)
      .values({
        subjectType: subject.type,
        subjectId: subjectIdOf(subject),
        userId: subject.userId,
        verdict,
        score,
        configVersion: ctx.configVersion,
        durationMs,
      })
      .returning({ id: fraudEvaluations.id })

    const evaluationId = evaluation!.id

    if (results.length > 0) {
      await ctx.db.insert(fraudCheckResults).values(
        results.map((r) => ({
          evaluationId,
          checkKey: r.checkKey,
          verdict: r.verdict,
          scoreDelta: r.scoreDelta,
          details: (r.details ?? null) as Record<string, unknown> | null,
          durationMs: r.durationMs,
          error: r.error ?? null,
        })),
      )
    }

    if (verdict === 'review' || verdict === 'deny') {
      await ctx.db.insert(reviewItems).values({
        subjectType: subject.type,
        subjectId: subjectIdOf(subject),
        userId: subject.userId,
        evaluationId,
        reason: summarise(results),
        // Payout review is the queue that protects cash, so it sorts first.
        priority: subject.type === 'payout' ? 100 : score,
      })
    }

    return { evaluationId, verdict, score, results, durationMs }
  }

  private decide(
    score: number,
    results: EvaluationResult['results'],
    ctx: FraudContext,
  ): FraudVerdict {
    // An explicit deny from any single check wins outright. Some signals —
    // a payout destination shared with three other accounts — are conclusive
    // on their own and should not be diluted by an averaged score.
    if (results.some((r) => r.verdict === 'deny')) return 'deny'

    const degraded = results.filter((r) => r.verdict === 'unavailable')
    if (degraded.length > 0 && ctx.settings.fraud_fail_mode === 'closed') {
      // Only escalate for checks that actually errored, not for ones honestly
      // reporting they have no provider configured. Otherwise every event goes
      // to review purely because we have no IPQS account yet.
      if (degraded.some((r) => r.error)) return 'review'
    }

    if (score >= ctx.settings.fraud_deny_score) return 'deny'
    if (score >= ctx.settings.fraud_review_score) return 'review'
    return 'allow'
  }
}

function subjectIdOf(subject: FraudSubject): string {
  switch (subject.type) {
    case 'completion':
      return subject.completionId
    case 'payout':
      return subject.payoutId
    default:
      return subject.userId
  }
}

function summarise(results: EvaluationResult['results']): string {
  const notable = results
    .filter((r) => r.scoreDelta > 0 || r.verdict === 'deny' || r.error)
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, 4)
    .map((r) => `${r.checkKey}(${r.verdict}${r.scoreDelta ? ` +${r.scoreDelta}` : ''})`)
  return notable.length > 0 ? notable.join(', ') : 'flagged with no contributing check'
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
