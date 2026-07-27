import type { Database } from '@app/db'

/** Works with either a pooled connection or an open transaction. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export type LedgerEntryType =
  | 'earn'
  | 'screenout'
  | 'reversal'
  | 'redeem'
  | 'redeem_refund'
  | 'manual_adjustment'
  | 'bonus'
  | 'referral_bonus'
  | 'referral_commission'

export type LedgerEntryStatus = 'pending' | 'posted' | 'rejected' | 'void'

/**
 * Balance is never one number.
 *
 *  posted        every posted entry, including credits still inside their hold
 *  withdrawable  what the user may actually cash out right now
 *  onHold        posted but not yet past `available_at`
 *  pending       held for fraud review; counts toward nothing yet
 *
 * The user-facing "your balance" figure is `posted`. Redemption eligibility
 * uses `withdrawable` and nothing else.
 */
export type BalanceSnapshot = {
  posted: number
  withdrawable: number
  onHold: number
  pending: number
  lifetimeEarned: number
}

export type RecordInput = {
  userId: string
  amountPoints: number
  type: LedgerEntryType
  idempotencyKey: string
  status?: LedgerEntryStatus
  /**
   * Hold length in hours, computed against the DATABASE clock. Prefer this
   * over `availableAt` — app-server and database clocks drift, and comparing
   * one against the other is how freshly credited points end up briefly
   * non-withdrawable.
   */
  holdHours?: number
  /**
   * Absolute override for when these points become withdrawable. Only for
   * admin action and for tests that need determinism. Omit both this and
   * `holdHours` to make points available immediately.
   */
  availableAt?: Date
  networkId?: string
  completionId?: string
  payoutId?: string
  referralId?: string
  reversesEntryId?: string
  externalTransactionId?: string
  configVersion?: number
  note?: string
  createdByAdminId?: string
  /**
   * Backdate the entry. Only for seeding and for importing history from a
   * system we are migrating off — ordinary writes must let the database stamp
   * the time, for the same clock-authority reason hold windows do.
   *
   * The immutability trigger blocks any later change to `created_at`, so this
   * is a one-shot decision at insert.
   */
  createdAt?: Date
}

export type LedgerEntryRow = {
  id: string
  userId: string
  amountPoints: number
  type: LedgerEntryType
  status: LedgerEntryStatus
  idempotencyKey: string
  availableAt: Date
  createdAt: Date
}

export type RecordResult = {
  entry: LedgerEntryRow
  /**
   * False when this exact write already existed. Callers use it to avoid
   * re-running side effects (referral commission, notifications) on a retried
   * postback.
   */
  created: boolean
}

export type ReversalResult = {
  /** Null when the balance was already zero and nothing could be clawed back. */
  entry: LedgerEntryRow | null
  created: boolean
  /** How much was actually reversed. */
  reversedPoints: number
  /**
   * How much the network clawed back that we could not recover, because the
   * user had already spent it and `allow_negative_balance` is false. This is a
   * real loss and is reported as one.
   */
  absorbedPoints: number
}
