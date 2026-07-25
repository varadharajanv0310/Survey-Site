import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { makeNetwork, makeUser, resetDb, testDb } from '../testing/db'
import { InsufficientBalanceError, LedgerService } from './service'
import { ledgerKeys } from './keys'

const db: Database = testDb()
const ledger = new LedgerService(db, { allowNegativeBalance: false })

/** Payout ids are real uuids in the schema, so tests use real uuids. */
const payoutId = () => crypto.randomUUID()

beforeEach(async () => {
  await resetDb(db)
})

afterAll(async () => {
  await resetDb(db)
})

describe('balance derivation', () => {
  it('separates posted, withdrawable and on-hold points', async () => {
    const userId = await makeUser(db)

    await ledger.record({
      userId,
      amountPoints: 600,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'available'),
    })

    // Still inside its hold window: counted as posted, not as withdrawable.
    await ledger.record({
      userId,
      amountPoints: 250,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'on-hold'),
      holdHours: 72,
    })

    // Held for fraud review: counted toward neither.
    await ledger.record({
      userId,
      amountPoints: 999,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'under-review'),
      status: 'pending',
    })

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(850)
    expect(balance.withdrawable).toBe(600)
    expect(balance.onHold).toBe(250)
    expect(balance.pending).toBe(999)
  })

  it('counts debits immediately even though credits wait', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'a'),
    })
    await ledger.record({
      userId,
      amountPoints: -400,
      type: 'redeem',
      idempotencyKey: ledgerKeys.redeem('payout-1'),
    })

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(600)
    expect(balance.withdrawable).toBe(600)
  })

  it('reports zero for a user with no entries', async () => {
    const userId = await makeUser(db)
    const balance = await ledger.getBalance(userId)
    expect(balance).toEqual({
      posted: 0,
      withdrawable: 0,
      onHold: 0,
      pending: 0,
      lifetimeEarned: 0,
    })
  })
})

describe('idempotency', () => {
  it('does not double-credit a retried postback', async () => {
    const userId = await makeUser(db)
    const key = ledgerKeys.earn('sim', 'tx-retry')

    const first = await ledger.record({ userId, amountPoints: 500, type: 'earn', idempotencyKey: key })
    const second = await ledger.record({ userId, amountPoints: 500, type: 'earn', idempotencyKey: key })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.entry.id).toBe(first.entry.id)

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(500)
  })

  it('survives the same postback arriving four times at once', async () => {
    const userId = await makeUser(db)
    const key = ledgerKeys.earn('sim', 'tx-thundering-herd')

    // This is what a network retrying on a slow response actually looks like:
    // concurrent, not sequential. Anything relying on read-then-write in
    // application code fails here; the unique index does not.
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        ledger.record({ userId, amountPoints: 300, type: 'earn', idempotencyKey: key }),
      ),
    )

    expect(results.filter((r) => r.created)).toHaveLength(1)
    const ids = new Set(results.map((r) => r.entry.id))
    expect(ids.size).toBe(1)

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(300)
  })

  it('treats a credit and its later reversal as distinct writes', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 500,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-9'),
    })

    // The network reuses the transaction id when it claws back. If the key
    // were the transaction id alone, this would silently no-op.
    const result = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-9', 'rev-1'),
    })

    expect(result.created).toBe(true)
    expect((await ledger.getBalance(userId)).posted).toBe(0)
  })
})

describe('reversals', () => {
  it('reverses in full by default', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 800,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-full'),
    })

    const result = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-full', 'r1'),
    })

    expect(result.reversedPoints).toBe(800)
    expect(result.absorbedPoints).toBe(0)
    expect((await ledger.getBalance(userId)).posted).toBe(0)
  })

  it('supports partial clawbacks and refuses to exceed the original', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-partial'),
    })

    const first = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-partial', 'r1'),
      amountPoints: 400,
    })
    expect(first.reversedPoints).toBe(400)

    // Asking for 900 more when only 600 remains reversible clamps to 600.
    const second = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-partial', 'r2'),
      amountPoints: 900,
    })
    expect(second.reversedPoints).toBe(600)

    expect((await ledger.getBalance(userId)).posted).toBe(0)

    // Nothing left to claw back.
    const third = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-partial', 'r3'),
      amountPoints: 100,
    })
    expect(third.reversedPoints).toBe(0)
    expect(third.entry).toBeNull()
  })

  it('refuses to reverse a debit', async () => {
    const userId = await makeUser(db)
    const debit = await ledger.record({
      userId,
      amountPoints: -200,
      type: 'redeem',
      idempotencyKey: ledgerKeys.redeem('payout-x'),
    })

    await expect(
      ledger.reverse({
        entryId: debit.entry.id,
        idempotencyKey: ledgerKeys.reversal('sim', 'tx-bad', 'r1'),
      }),
    ).rejects.toThrow(/cannot reverse a debit/)
  })

  it('rejects an over-reversal written directly against the database', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 100,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-trigger'),
    })

    // Bypassing the service entirely. The guarantee has to hold at the
    // database, not just in the code path we happen to have written.
    await expect(
      db.execute(sql`
        INSERT INTO ledger_entries (user_id, amount_points, type, idempotency_key, reverses_entry_id)
        VALUES (${userId}, -500, 'reversal', 'reversal:sim:tx-trigger:evil', ${earn.entry.id})
      `),
    ).rejects.toThrow(/over-reversal/)
  })
})

describe('floor at zero', () => {
  it('absorbs the shortfall when a clawback lands after the user cashed out', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-late'),
    })

    // The user cashes out almost everything before the network reverses.
    await ledger.record({
      userId,
      amountPoints: -900,
      type: 'redeem',
      idempotencyKey: ledgerKeys.redeem('payout-late'),
    })

    const result = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-late', 'r1'),
    })

    // Only 100 was recoverable. The other 900 is our loss, and it is reported
    // rather than quietly driving the balance negative.
    expect(result.reversedPoints).toBe(100)
    expect(result.absorbedPoints).toBe(900)

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(0)
    expect(balance.posted).toBeGreaterThanOrEqual(0)
  })

  it('writes no entry at all when the balance is already zero', async () => {
    const userId = await makeUser(db)
    const earn = await ledger.record({
      userId,
      amountPoints: 500,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-zero'),
    })
    await ledger.record({
      userId,
      amountPoints: -500,
      type: 'redeem',
      idempotencyKey: ledgerKeys.redeem('payout-zero'),
    })

    const result = await ledger.reverse({
      entryId: earn.entry.id,
      idempotencyKey: ledgerKeys.reversal('sim', 'tx-zero', 'r1'),
    })

    expect(result.entry).toBeNull()
    expect(result.reversedPoints).toBe(0)
    expect(result.absorbedPoints).toBe(500)
    expect((await ledger.getBalance(userId)).posted).toBe(0)
  })
})

describe('payout reserve', () => {
  it('debits at request time so a balance cannot be spent twice', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-reserve'),
    })

    const first = payoutId()
    await ledger.reserveForPayout({
      userId,
      points: 1000,
      payoutId: first,
      idempotencyKey: ledgerKeys.redeem(first),
    })

    const second = payoutId()
    await expect(
      ledger.reserveForPayout({
        userId,
        points: 1000,
        payoutId: second,
        idempotencyKey: ledgerKeys.redeem(second),
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it('uses withdrawable, not posted, so held points cannot be cashed out', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-held'),
      holdHours: 72,
    })

    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(1000)
    expect(balance.withdrawable).toBe(0)

    const held = payoutId()
    await expect(
      ledger.reserveForPayout({
        userId,
        points: 500,
        payoutId: held,
        idempotencyKey: ledgerKeys.redeem(held),
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it('refunds a failed payout without touching the original debit', async () => {
    const userId = await makeUser(db)
    await ledger.record({
      userId,
      amountPoints: 1000,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-refund'),
    })
    const failing = payoutId()
    const reserve = await ledger.reserveForPayout({
      userId,
      points: 600,
      payoutId: failing,
      idempotencyKey: ledgerKeys.redeem(failing),
    })

    await ledger.refundPayout({
      userId,
      points: 600,
      payoutId: failing,
      idempotencyKey: ledgerKeys.redeemRefund(failing),
      reason: 'provider rejected the destination',
    })

    expect((await ledger.getBalance(userId)).posted).toBe(1000)

    // The debit is still there. History is added to, never rewritten.
    const rows = (await db.execute(sql`
      SELECT amount_points::TEXT AS amt FROM ledger_entries WHERE id = ${reserve.entry.id}
    `)) as unknown as { amt: string }[]
    expect(Number(rows[0]!.amt)).toBe(-600)
  })
})

describe('held credits', () => {
  it('posts a reviewed credit and counts it only then', async () => {
    const userId = await makeUser(db)
    const held = await ledger.record({
      userId,
      amountPoints: 400,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-review'),
      status: 'pending',
    })

    expect((await ledger.getBalance(userId)).posted).toBe(0)

    await ledger.resolvePending(held.entry.id, 'posted')
    expect((await ledger.getBalance(userId)).posted).toBe(400)
  })

  it('rejects a credit without ever counting it', async () => {
    const userId = await makeUser(db)
    const held = await ledger.record({
      userId,
      amountPoints: 400,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-denied'),
      status: 'pending',
    })

    await ledger.resolvePending(held.entry.id, 'rejected')
    const balance = await ledger.getBalance(userId)
    expect(balance.posted).toBe(0)
    expect(balance.pending).toBe(0)
  })

  it('cannot resolve the same held credit twice', async () => {
    const userId = await makeUser(db)
    const held = await ledger.record({
      userId,
      amountPoints: 400,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-twice'),
      status: 'pending',
    })

    await ledger.resolvePending(held.entry.id, 'posted')
    await expect(ledger.resolvePending(held.entry.id, 'rejected')).rejects.toThrow(/not pending/)
  })
})

describe('database-level guarantees', () => {
  it('refuses to delete a ledger row', async () => {
    const userId = await makeUser(db)
    const entry = await ledger.record({
      userId,
      amountPoints: 100,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-del'),
    })

    await expect(
      db.execute(sql`DELETE FROM ledger_entries WHERE id = ${entry.entry.id}`),
    ).rejects.toThrow(/cannot be deleted/)
  })

  it('refuses to edit an amount', async () => {
    const userId = await makeUser(db)
    const entry = await ledger.record({
      userId,
      amountPoints: 100,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-edit'),
    })

    await expect(
      db.execute(sql`UPDATE ledger_entries SET amount_points = 5000 WHERE id = ${entry.entry.id}`),
    ).rejects.toThrow(/immutable/)
  })

  it('refuses to move an entry to another account', async () => {
    const userId = await makeUser(db)
    const otherId = await makeUser(db)
    const entry = await ledger.record({
      userId,
      amountPoints: 100,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim', 'tx-move'),
    })

    await expect(
      db.execute(sql`UPDATE ledger_entries SET user_id = ${otherId} WHERE id = ${entry.entry.id}`),
    ).rejects.toThrow(/immutable/)
  })

  it('refuses an earn with a negative amount', async () => {
    const userId = await makeUser(db)
    await expect(
      db.execute(sql`
        INSERT INTO ledger_entries (user_id, amount_points, type, idempotency_key)
        VALUES (${userId}, -100, 'earn', 'earn:sim:wrong-sign')
      `),
    ).rejects.toThrow()
  })

  it('links entries to the network that produced them', async () => {
    const userId = await makeUser(db)
    const networkId = await makeNetwork(db, { key: 'sim_offer' })

    const entry = await ledger.record({
      userId,
      amountPoints: 250,
      type: 'earn',
      idempotencyKey: ledgerKeys.earn('sim_offer', 'tx-net'),
      networkId,
      externalTransactionId: 'tx-net',
    })

    expect(entry.created).toBe(true)
    const rows = (await db.execute(sql`
      SELECT network_id FROM ledger_entries WHERE id = ${entry.entry.id}
    `)) as unknown as { network_id: string }[]
    expect(rows[0]!.network_id).toBe(networkId)
  })
})
