import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { makeUser, resetDb, testDb } from '../testing/db'
import { InsufficientBalanceError, LedgerService } from './service'
import { ledgerKeys } from './keys'

/**
 * Concurrency tests.
 *
 * These issue genuinely simultaneous writes through a real connection pool
 * against a real Postgres. That matters: every one of these scenarios passes
 * trivially when the same calls are made sequentially, which is exactly why a
 * read-then-write race can sit in a codebase for months looking correct.
 *
 * The invariant under test is always the same and always the one that costs
 * money: **a user must never be able to spend the same points twice, and the
 * balance must never go negative.**
 */

const db: Database = testDb()
const ledger = new LedgerService(db, { allowNegativeBalance: false })

beforeEach(async () => {
  await resetDb(db)
})

afterAll(async () => {
  await resetDb(db)
})

const settled = async <T>(promises: Promise<T>[]) => {
  const results = await Promise.allSettled(promises)
  return {
    fulfilled: results.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled'),
    rejected: results.filter((r): r is PromiseRejectedResult => r.status === 'rejected'),
  }
}

describe('concurrent payout reserves', () => {
  it('lets exactly one of eight simultaneous full-balance payouts through', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-race-1'),
    })

    // Eight requests, each for the entire balance, fired at once. Sequentially
    // this is trivially safe. Concurrently, a read-then-write reserve lets all
    // eight read 1000, all eight pass the check, and all eight debit.
    const { fulfilled, rejected } = await settled(
      Array.from({ length: 8 }, () => {
        const payoutId = crypto.randomUUID()
        return ledger.reserveForPayout({
          userId,
          points: 1000,
          payoutId,
          idempotencyKey: ledgerKeys.redeem(payoutId),
        })
      }),
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(7)
    for (const failure of rejected) {
      expect(failure.reason).toBeInstanceOf(InsufficientBalanceError)
    }

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(0)
    expect(balance.withdrawable).toBe(0)
  })

  it('lets exactly four of ten simultaneous quarter-balance payouts through', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-race-2'),
    })

    // Ten requests of 250 against a balance of 1000: four should succeed.
    // A partial-overlap case, which a naive lock-free implementation gets
    // wrong in a subtler way than the all-or-nothing case above.
    const { fulfilled } = await settled(
      Array.from({ length: 10 }, () => {
        const payoutId = crypto.randomUUID()
        return ledger.reserveForPayout({
          userId,
          points: 250,
          payoutId,
          idempotencyKey: ledgerKeys.redeem(payoutId),
        })
      }),
    )

    expect(fulfilled).toHaveLength(4)
    expect((await ledger.getBalance(userId)).posted).toBe(0)
  })

  it('keeps separate users independent under load', async () => {
    // The lock must be per-user. If it were global this would still pass, so
    // this is really a check that we have not serialised the whole system —
    // asserted by both users succeeding, not by timing.
    const a = await makeUser(db)
    const b = await makeUser(db)

    for (const userId of [a, b]) {
      await ledger.record({
        userId,
        amountPoints: 500,
        type: 'earn',
        idempotencyKey: ledgerKeys.earn('sim', `tx-indep-${userId}`),
      })
    }

    const { fulfilled } = await settled(
      [a, b, a, b].map((userId) => {
        const payoutId = crypto.randomUUID()
        return ledger.reserveForPayout({
          userId,
          points: 500,
          payoutId,
          idempotencyKey: ledgerKeys.redeem(payoutId),
        })
      }),
    )

    expect(fulfilled).toHaveLength(2)
    expect((await ledger.getBalance(a)).posted).toBe(0)
    expect((await ledger.getBalance(b)).posted).toBe(0)
  })
})

describe('concurrent clawbacks', () => {
  /**
   * The database trigger already refuses to over-reverse a single entry, so a
   * naive implementation survives the obvious test. This one reverses two
   * DIFFERENT entries at once, where the only thing standing between us and a
   * negative balance is the floor-at-zero clamp — which is a read-then-write.
   */
  it('never drives the balance negative when two clawbacks land together', async () => {
    const userId = await makeUser(db)

    const first = await ledger.record({
      userId,
      amountPoints: 500,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-claw-a'),
      externalTransactionId: 'tx-claw-a',
    })
    const second = await ledger.record({
      userId,
      amountPoints: 500,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-claw-b'),
      externalTransactionId: 'tx-claw-b',
    })

    // The user cashes out almost everything, leaving 100 recoverable.
    await ledger.record({
      userId,
      amountPoints: -900,
      type: 'redeem',
      idempotencyKey: ledgerKeys.redeem(crypto.randomUUID()),
    })
    expect((await ledger.getBalance(userId)).posted).toBe(100)

    // Both networks claw back 500 at the same moment. Only 100 exists.
    const { fulfilled } = await settled([
      ledger.reverse({
        entryId: first.entry.id,
        idempotencyKey: ledgerKeys.reversal('sim', 'tx-claw-a', 'r1'),
      }),
      ledger.reverse({
        entryId: second.entry.id,
        idempotencyKey: ledgerKeys.reversal('sim', 'tx-claw-b', 'r1'),
      }),
    ])

    expect(fulfilled).toHaveLength(2)

    const totalReversed = fulfilled.reduce((sum, r) => sum + r.value.reversedPoints, 0)
    const totalAbsorbed = fulfilled.reduce((sum, r) => sum + r.value.absorbedPoints, 0)

    // We can only recover what the user still had.
    expect(totalReversed).toBe(100)
    // The rest is a real loss and must be reported, not silently dropped.
    expect(totalAbsorbed).toBe(900)

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(0)
    expect(balance.posted).toBeGreaterThanOrEqual(0)
  })

  it('refuses to over-reverse one entry even under concurrent attempts', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 600,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-over'),
    })

    // Six simultaneous clawbacks of 200 against a 600 entry. Three are valid;
    // the rest must find nothing left rather than stacking.
    const { fulfilled } = await settled(
      Array.from({ length: 6 }, (_, i) =>
        ledger.reverse({
          entryId: earn.entry.id,
          idempotencyKey: ledgerKeys.reversal('sim', 'tx-over', `r${i}`),
          amountPoints: 200,
        }),
      ),
    )

    const totalReversed = fulfilled.reduce((sum, r) => sum + r.value.reversedPoints, 0)
    expect(totalReversed).toBeLessThanOrEqual(600)

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBeGreaterThanOrEqual(0)

    const rows = (await db.execute(sql`
      SELECT COALESCE(SUM(-amount_points), 0)::TEXT AS reversed
      FROM ledger_entries
      WHERE reverses_entry_id = ${earn.entry.id} AND type = 'reversal'
    `)) as unknown as { reversed: string }[]
    expect(Number(rows[0]!.reversed)).toBeLessThanOrEqual(600)
  })
})

describe('concurrent credits', () => {
  it('does not lose credits that arrive together', async () => {
    // Credits are blind inserts guarded by a unique key, so they are safe
    // without a lock — but only if nothing has quietly serialised or dropped
    // them. Twenty distinct completions must produce twenty entries.
    const userId = await makeUser(db)

    const { fulfilled } = await settled(
      Array.from({ length: 20 }, (_, i) =>
        ledger.record({
          userId,
          amountPoints: 50,
          type: 'earn',
          idempotencyKey: ledgerKeys.earn('sim', `tx-parallel-${i}`),
        }),
      ),
    )

    expect(fulfilled).toHaveLength(20)
    expect(fulfilled.every((r) => r.value.created)).toBe(true)
    expect((await ledger.getBalance(userId)).posted).toBe(1000)
  })

  it('credits arriving during a payout reserve cannot corrupt the balance', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-mixed-base'),
    })

    // Interleave ten credits with four full-balance payout attempts. Whatever
    // ordering the database picks, the arithmetic has to add up exactly.
    const credits = Array.from({ length: 10 }, (_, i) =>
      ledger.record({
        userId,
        amountPoints: 100,
        type: 'earn',
        idempotencyKey: ledgerKeys.earn('sim', `tx-mixed-${i}`),
      }),
    )
    const reserves = Array.from({ length: 4 }, () => {
      const payoutId = crypto.randomUUID()
      return ledger.reserveForPayout({
        userId,
        points: 1000,
        payoutId,
        idempotencyKey: ledgerKeys.redeem(payoutId),
      })
    })

    const { fulfilled: creditResults } = await settled(credits)
    const { fulfilled: reserveResults } = await settled(reserves)

    expect(creditResults).toHaveLength(10)

    const credited = 1000 + 10 * 100
    const debited = reserveResults.length * 1000
    const balance = await ledger.getBalance(userId)

    expect(balance.posted).toBe(credited - debited)
    expect(balance.posted).toBeGreaterThanOrEqual(0)
  })
})
