import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { ledgerEntries } from '@app/db/schema'
import type {
  BalanceSnapshot,
  Executor,
  LedgerEntryRow,
  RecordInput,
  RecordResult,
  ReversalResult,
} from './types'

export class InsufficientBalanceError extends Error {
  constructor(
    readonly userId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(`user ${userId} requested ${requested} points but only ${available} are withdrawable`)
    this.name = 'InsufficientBalanceError'
  }
}

export class LedgerService {
  constructor(
    private readonly db: Database,
    private readonly options: { allowNegativeBalance: boolean } = { allowNegativeBalance: false },
  ) {}

  /**
   * Derived on every call. There is no cached balance column, deliberately.
   *
   * This is O(entries-per-user) and will not hold up forever. The fix when it
   * stops holding up is a checkpoint table (balance as of entry N, sum forward
   * from there) which keeps the ledger authoritative — not a mutable column on
   * the user.
   */
  async getBalance(userId: string, exec: Executor = this.db): Promise<BalanceSnapshot> {
    const rows = await exec.execute(sql`
      SELECT
        COALESCE(SUM(amount_points) FILTER (WHERE status = 'posted'), 0)::TEXT AS posted,
        COALESCE(SUM(amount_points) FILTER (WHERE status = 'posted' AND available_at <= now()), 0)::TEXT AS withdrawable,
        COALESCE(SUM(amount_points) FILTER (WHERE status = 'posted' AND available_at > now()), 0)::TEXT AS on_hold,
        COALESCE(SUM(amount_points) FILTER (WHERE status = 'pending'), 0)::TEXT AS pending,
        COALESCE(SUM(amount_points) FILTER (WHERE status = 'posted' AND amount_points > 0), 0)::TEXT AS lifetime_earned
      FROM ledger_entries
      WHERE user_id = ${userId}
    `)

    const row = (rows as unknown as Record<string, string>[])[0]
    return {
      posted: Number(row?.posted ?? 0),
      withdrawable: Number(row?.withdrawable ?? 0),
      onHold: Number(row?.on_hold ?? 0),
      pending: Number(row?.pending ?? 0),
      lifetimeEarned: Number(row?.lifetime_earned ?? 0),
    }
  }

  /**
   * The only way points enter or leave the system.
   *
   * Idempotent by construction: a duplicate `idempotencyKey` returns the
   * existing row with `created: false` rather than raising. Callers gate their
   * side effects on `created`, because a network retrying a postback four
   * times must not send four notifications or pay four referral commissions.
   */
  async record(input: RecordInput, exec: Executor = this.db): Promise<RecordResult> {
    const status = input.status ?? 'posted'

    const values: Record<string, unknown> = {
      userId: input.userId,
      amountPoints: input.amountPoints,
      type: input.type,
      status,
      idempotencyKey: input.idempotencyKey,
      networkId: input.networkId ?? null,
      completionId: input.completionId ?? null,
      payoutId: input.payoutId ?? null,
      referralId: input.referralId ?? null,
      reversesEntryId: input.reversesEntryId ?? null,
      externalTransactionId: input.externalTransactionId ?? null,
      configVersion: input.configVersion ?? 0,
      note: input.note ?? null,
      createdByAdminId: input.createdByAdminId ?? null,
      // Postgres' clock, never the application's. See below.
      postedAt: status === 'posted' ? sql`now()` : null,
    }

    /**
     * The database is the only clock that counts.
     *
     * Taking `new Date()` here and comparing it against `now()` in the balance
     * query compares two different machines' clocks. Locally that drift is a
     * few hundred milliseconds — enough that points credited a moment ago are
     * briefly not withdrawable — and across real app servers it can be
     * seconds. Every hold window is therefore computed server-side.
     *
     * An explicit `availableAt` is still honoured, for admin overrides and for
     * tests that need a deterministic absolute time.
     */
    if (input.availableAt) {
      values.availableAt = input.availableAt
    } else if (input.holdHours && input.holdHours > 0) {
      values.availableAt = sql`now() + make_interval(hours => ${input.holdHours})`
    }
    // Otherwise omitted entirely, so the column's own `now()` default applies.

    const inserted = await exec
      .insert(ledgerEntries)
      .values(values as typeof ledgerEntries.$inferInsert)
      .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
      .returning()

    if (inserted.length > 0) {
      return { entry: toRow(inserted[0]!), created: true }
    }

    const existing = await exec
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, input.idempotencyKey))
      .limit(1)

    if (existing.length === 0) {
      // The insert conflicted but the row is not visible. Under READ COMMITTED
      // this means a concurrent transaction holds it uncommitted. Surfacing it
      // rather than silently returning a wrong answer.
      throw new Error(
        `ledger write for key ${input.idempotencyKey} conflicted but no row is visible; ` +
          'a concurrent uncommitted write holds this key',
      )
    }

    return { entry: toRow(existing[0]!), created: false }
  }

  /**
   * Claw back a completion a network has decided was fraudulent.
   *
   * Two rules apply, and both are deliberate:
   *
   * 1. Partial reversals are normal. Networks sometimes claw back part of a
   *    payout. `amountPoints` defaults to the full original.
   *
   * 2. With `allowNegativeBalance: false` the reversal is CLAMPED to what the
   *    user still has. If the network claws back 500 points and the user has
   *    already cashed out down to 100, we reverse 100 and absorb 400. The
   *    absorbed amount is returned and recorded, because it is a real loss and
   *    hiding it would make the margin reporting lie.
   */
  async reverse(
    input: {
      entryId: string
      idempotencyKey: string
      amountPoints?: number
      reason?: string
      externalTransactionId?: string
      configVersion?: number
    },
    exec: Executor = this.db,
  ): Promise<ReversalResult> {
    const [original] = await exec
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, input.entryId))
      .limit(1)

    if (!original) throw new Error(`cannot reverse: entry ${input.entryId} not found`)
    if (original.amountPoints <= 0) {
      throw new Error(`cannot reverse a debit (entry ${input.entryId}, ${original.amountPoints})`)
    }

    // A reversal of an already-reversed entry is a no-op, not an error. The
    // idempotency key would catch an exact retry, but a network re-sending the
    // same clawback under a new event id would not be caught by that alone.
    const [{ alreadyReversed }] = (await exec.execute(sql`
      SELECT COALESCE(SUM(-amount_points), 0)::TEXT AS "alreadyReversed"
      FROM ledger_entries
      WHERE reverses_entry_id = ${input.entryId}
        AND type = 'reversal'
        AND status <> 'rejected'
    `)) as unknown as { alreadyReversed: string }[]

    const remaining = original.amountPoints - Number(alreadyReversed)
    const requested = Math.min(input.amountPoints ?? original.amountPoints, remaining)

    if (requested <= 0) {
      return { entry: null, created: false, reversedPoints: 0, absorbedPoints: 0 }
    }

    let toReverse = requested
    let absorbed = 0

    if (!this.options.allowNegativeBalance) {
      const balance = await this.getBalance(original.userId, exec)
      const recoverable = Math.max(0, balance.posted)
      if (requested > recoverable) {
        toReverse = recoverable
        absorbed = requested - recoverable
      }
    }

    if (toReverse <= 0) {
      return { entry: null, created: false, reversedPoints: 0, absorbedPoints: requested }
    }

    const note =
      absorbed > 0
        ? `${input.reason ?? 'network reversal'} (absorbed ${absorbed} points: balance floored at zero)`
        : (input.reason ?? 'network reversal')

    const result = await this.record(
      {
        userId: original.userId,
        amountPoints: -toReverse,
        type: 'reversal',
        idempotencyKey: input.idempotencyKey,
        reversesEntryId: original.id,
        networkId: original.networkId ?? undefined,
        completionId: original.completionId ?? undefined,
        externalTransactionId: input.externalTransactionId ?? original.externalTransactionId ?? undefined,
        configVersion: input.configVersion ?? 0,
        note,
      },
      exec,
    )

    return {
      entry: result.entry,
      created: result.created,
      reversedPoints: toReverse,
      absorbedPoints: absorbed,
    }
  }

  /**
   * Debit for a payout at REQUEST time, not at paid time.
   *
   * Without this a user with 1000 withdrawable points can request three
   * 1000-point payouts before an admin looks at the first one, and we pay all
   * three.
   *
   * ---------------------------------------------------------------------
   * KNOWN RACE. Read before touching real money.
   *
   * The balance check and the debit are two statements. Two concurrent
   * requests can both read 1000, both pass the check, and both insert. The
   * idempotency key does NOT save us here, because two genuine payout
   * requests have two different payout ids and therefore two different keys.
   *
   * This is the single place in the codebase where that race exists, which is
   * why the check and the write live in one function instead of being spread
   * across the payout service. The fix — SELECT ... FOR UPDATE on a per-user
   * lock row, or a serializable transaction with a retry loop — belongs in
   * the concurrency hardening pass, together with tests that actually run
   * concurrent writes. It is not safe to ship against a real payout provider
   * until then.
   * ---------------------------------------------------------------------
   */
  async reserveForPayout(
    input: { userId: string; points: number; payoutId: string; idempotencyKey: string },
    exec: Executor = this.db,
  ): Promise<RecordResult> {
    if (input.points <= 0) throw new Error('payout reserve must be positive')

    const balance = await this.getBalance(input.userId, exec)
    if (balance.withdrawable < input.points) {
      throw new InsufficientBalanceError(input.userId, input.points, balance.withdrawable)
    }

    return this.record(
      {
        userId: input.userId,
        amountPoints: -input.points,
        type: 'redeem',
        idempotencyKey: input.idempotencyKey,
        payoutId: input.payoutId,
        note: 'payout reserve',
      },
      exec,
    )
  }

  /** Return a reserve to the user when a payout is cancelled or fails. */
  async refundPayout(
    input: { userId: string; points: number; payoutId: string; idempotencyKey: string; reason: string },
    exec: Executor = this.db,
  ): Promise<RecordResult> {
    return this.record(
      {
        userId: input.userId,
        amountPoints: input.points,
        type: 'redeem_refund',
        idempotencyKey: input.idempotencyKey,
        payoutId: input.payoutId,
        note: input.reason,
      },
      exec,
    )
  }

  /**
   * Resolve a credit that was held for fraud review.
   *
   * A held credit resolves to `posted` or `rejected` and nothing else; the
   * database trigger rejects any other transition, including going back to
   * pending.
   */
  async resolvePending(
    entryId: string,
    outcome: 'posted' | 'rejected',
    exec: Executor = this.db,
  ): Promise<LedgerEntryRow> {
    const updated = await exec
      .update(ledgerEntries)
      .set({ status: outcome })
      .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.status, 'pending')))
      .returning()

    if (updated.length === 0) {
      throw new Error(`entry ${entryId} is not pending, or does not exist`)
    }
    return toRow(updated[0]!)
  }

  /** Full history for the user-facing transaction list and admin detail view. */
  async history(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
    exec: Executor = this.db,
  ) {
    return exec
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId))
      .orderBy(sql`created_at DESC`)
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0)
  }
}

function toRow(r: typeof ledgerEntries.$inferSelect): LedgerEntryRow {
  return {
    id: r.id,
    userId: r.userId,
    amountPoints: r.amountPoints,
    type: r.type,
    status: r.status,
    idempotencyKey: r.idempotencyKey,
    availableAt: r.availableAt,
    createdAt: r.createdAt,
  }
}
