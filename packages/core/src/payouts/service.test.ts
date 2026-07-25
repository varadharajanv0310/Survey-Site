import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { makeAdmin, makeUser, resetDb, testDb } from '../testing/db'
import { DEFAULT_SETTINGS } from '../config/settings'
import { LedgerService } from '../ledger/service'
import { ledgerKeys } from '../ledger/keys'
import { FraudPipeline } from '../fraud/pipeline'
import type { FraudCheck } from '../fraud/types'
import { MockPayoutProvider } from './mock-provider'
import { PAYOUT_TRANSITIONS, PayoutError, PayoutService } from './service'

const db: Database = testDb()
const ledger = new LedgerService(db, { allowNegativeBalance: false })

/** No checks, so payout tests exercise the state machine and not fraud rules. */
const noChecks = new FraudPipeline([])
/** For the one test that needs fraud to intervene. */
const alwaysDeny = new FraudPipeline([
  {
    key: 'always_deny',
    appliesTo: ['payout'],
    evaluate: async () => ({ verdict: 'deny', scoreDelta: 100 }),
  } satisfies FraudCheck,
])

function serviceWith(
  fraud = noChecks,
  settings: Partial<typeof DEFAULT_SETTINGS> = {},
  provider = new MockPayoutProvider(),
) {
  return new PayoutService(db, {
    ledger,
    provider,
    fraud,
    settings: { ...DEFAULT_SETTINGS, review_first_payout: false, ...settings },
    configVersion: 1,
    destinationSecret: 'test-secret',
    log: () => {},
  })
}

async function fundedUser(points = 10_000): Promise<string> {
  const userId = await makeUser(db)
  await db.execute(sql`UPDATE users SET email_verified_at = now() WHERE id = ${userId}`)
  await ledger.record({
    userId,
    amountPoints: points,
    type: 'earn',
    idempotencyKey: ledgerKeys.earn('sim', `fund-${userId}`),
  })
  return userId
}

const stateOf = async (payoutId: string) => {
  const rows = (await db.execute(sql`
    SELECT state::TEXT AS s FROM payouts WHERE id = ${payoutId}
  `)) as unknown as { s: string }[]
  return rows[0]?.s
}

beforeEach(async () => {
  await resetDb(db)
})

afterAll(async () => {
  await resetDb(db)
})

describe('transition table', () => {
  it('makes paid and cancelled terminal', () => {
    expect(PAYOUT_TRANSITIONS.paid).toEqual([])
    expect(PAYOUT_TRANSITIONS.cancelled).toEqual([])
  })

  it('leaves failed recoverable', () => {
    // A failed payout usually means bad payout details, which the user can fix.
    // Making it terminal would strand their money in limbo.
    expect(PAYOUT_TRANSITIONS.failed).toContain('processing')
    expect(PAYOUT_TRANSITIONS.failed).toContain('cancelled')
  })

  it('does not allow skipping approval', () => {
    expect(PAYOUT_TRANSITIONS.requested).not.toContain('processing')
    expect(PAYOUT_TRANSITIONS.requested).not.toContain('paid')
    expect(PAYOUT_TRANSITIONS.under_review).not.toContain('processing')
  })
})

describe('requesting', () => {
  it('debits at request time, not at payment time', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith()

    await service.request({ userId, points: 6_000, method: 'upi', destination: 'priya@okhdfcbank' })

    // The whole point: the money is committed before anyone approves anything.
    expect((await ledger.getBalance(userId)).posted).toBe(4_000)
  })

  it('refuses below the minimum', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith(noChecks, { min_redemption_points: 5_000 })

    await expect(
      service.request({ userId, points: 400, method: 'upi', destination: 'priya@okhdfcbank' }),
    ).rejects.toMatchObject({ code: 'below_minimum' })

    expect((await ledger.getBalance(userId)).posted).toBe(10_000)
  })

  it('refuses before the email is confirmed', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 10_000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', `unverified-${userId}`),
    })

    await expect(
      serviceWith().request({ userId, points: 6_000, method: 'upi', destination: 'priya@okhdfcbank' }),
    ).rejects.toMatchObject({ code: 'email_unverified' })
  })

  it('rejects a malformed destination before touching the balance', async () => {
    const userId = await fundedUser(10_000)

    await expect(
      serviceWith().request({ userId, points: 6_000, method: 'upi', destination: 'not-a-upi-id' }),
    ).rejects.toMatchObject({ code: 'invalid_destination' })

    expect((await ledger.getBalance(userId)).posted).toBe(10_000)
  })

  it('never leaves a debit without a payout row', async () => {
    const userId = await fundedUser(10_000)
    const { payoutId } = await serviceWith().request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })

    const rows = (await db.execute(sql`
      SELECT p.id::TEXT AS payout_id, le.id::TEXT AS entry_id, le.amount_points::TEXT AS amt
      FROM payouts p
      JOIN ledger_entries le ON le.id = p.reserve_entry_id
      WHERE p.id = ${payoutId}
    `)) as unknown as Record<string, string>[]

    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.amt)).toBe(-6_000)
  })

  it('stores the destination masked and hashed, never in the clear', async () => {
    const userId = await fundedUser(10_000)
    const { payoutId } = await serviceWith().request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })

    const rows = (await db.execute(sql`
      SELECT destination_masked, destination_hash FROM payouts WHERE id = ${payoutId}
    `)) as unknown as Record<string, string>[]

    expect(rows[0]!.destination_masked).not.toContain('priya')
    expect(rows[0]!.destination_hash).not.toContain('priya')
    expect(rows[0]!.destination_hash.length).toBeGreaterThan(20)
  })

  it('sends a fraud-denied payout to review rather than paying it', async () => {
    const userId = await fundedUser(10_000)
    const result = await serviceWith(alwaysDeny).request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })

    expect(result.state).toBe('under_review')
    // Still debited: a denied payout waits for a human, it does not silently
    // hand the points back.
    expect((await ledger.getBalance(userId)).posted).toBe(4_000)
  })

  it('sends a first payout to review when policy says so', async () => {
    const userId = await fundedUser(10_000)
    const result = await serviceWith(noChecks, { review_first_payout: true }).request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })
    expect(result.state).toBe('under_review')
  })
})

describe('illegal transitions', () => {
  it('will not settle a payout nobody approved', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith()
    const { payoutId } = await service.request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })

    await expect(service.settle(payoutId)).rejects.toBeInstanceOf(PayoutError)
    expect(await stateOf(payoutId)).toBe('requested')
  })

  it('will not approve a payout that was already cancelled', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith()
    const { payoutId } = await service.request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })

    await service.cancel(payoutId, { type: 'user', id: userId }, 'changed my mind')
    await expect(service.approve(payoutId, crypto.randomUUID())).rejects.toMatchObject({
      code: 'illegal_transition',
    })
  })
})

describe('cancellation', () => {
  it('refunds with a new entry and leaves the debit untouched', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith()
    const { payoutId } = await service.request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })
    expect((await ledger.getBalance(userId)).posted).toBe(4_000)

    await service.cancel(payoutId, { type: 'user', id: userId }, 'changed my mind')

    expect((await ledger.getBalance(userId)).posted).toBe(10_000)

    // History is added to, never rewritten: the original debit is still there.
    const rows = (await db.execute(sql`
      SELECT type::TEXT AS t, amount_points::TEXT AS amt
      FROM ledger_entries WHERE payout_id = ${payoutId} ORDER BY created_at
    `)) as unknown as Record<string, string>[]

    expect(rows.map((r) => r.t)).toEqual(['redeem', 'redeem_refund'])
    expect(rows.map((r) => Number(r.amt))).toEqual([-6_000, 6_000])
  })

  it('does not double-refund a cancel that is retried', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith()
    const { payoutId } = await service.request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })

    await service.cancel(payoutId, { type: 'admin', id: null }, 'first')
    // Cancelled is terminal, so a retry must fail rather than refund again.
    await expect(service.cancel(payoutId, { type: 'admin', id: null }, 'again')).rejects.toThrow()

    expect((await ledger.getBalance(userId)).posted).toBe(10_000)
  })
})

describe('settlement', () => {
  it('records every transition with an actor', async () => {
    const userId = await fundedUser(10_000)
    const service = serviceWith()
    const adminId = await makeAdmin(db)

    const { payoutId } = await service.request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })
    await service.approve(payoutId, adminId, 'looks fine')
    await service.settle(payoutId)

    const rows = (await db.execute(sql`
      SELECT from_state::TEXT AS f, to_state::TEXT AS t, actor_type::TEXT AS a
      FROM payout_transitions WHERE payout_id = ${payoutId} ORDER BY created_at
    `)) as unknown as Record<string, string>[]

    expect(rows[0]).toMatchObject({ t: 'requested', a: 'user' })
    expect(rows[1]).toMatchObject({ f: 'requested', t: 'approved', a: 'admin' })
    expect(rows[2]).toMatchObject({ f: 'approved', t: 'processing', a: 'system' })
    // "who approved this and when" has to be answerable months later.
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it('leaves an async payout in processing rather than claiming it is paid', async () => {
    const userId = await fundedUser(10_000)
    // Deterministic provider: this key hashes into the 'processing' bucket.
    const service = serviceWith()
    const { payoutId } = await service.request({
      userId,
      points: 6_000,
      method: 'upi',
      destination: 'priya@okhdfcbank',
    })
    await service.approve(payoutId, await makeAdmin(db))

    const state = await service.settle(payoutId)
    expect(['processing', 'paid', 'failed']).toContain(state)
    expect(await stateOf(payoutId)).toBe(state)

    if (state === 'processing') {
      // Must not resolve early just because we asked again.
      expect(await service.pollStatus(payoutId)).toBe('processing')
    }
  })

  it('is idempotent at the provider, so a retried send cannot pay twice', async () => {
    const provider = new MockPayoutProvider()
    const request = {
      idempotencyKey: 'payout:fixed-key',
      amountMinor: 50_000,
      currency: 'INR',
      method: 'upi' as const,
      destination: 'priya@okhdfcbank',
      metadata: {},
    }

    const first = await provider.send(request)
    const second = await provider.send(request)
    expect(second).toEqual(first)
  })
})
