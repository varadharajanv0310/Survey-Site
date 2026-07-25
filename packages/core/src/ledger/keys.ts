/**
 * Idempotency keys are composed here and nowhere else.
 *
 * Every ledger write carries one, and a unique index on the column is the only
 * thing standing between us and paying twice for the same event. Networks
 * retry postbacks aggressively, users double-click, and the worker can die
 * between the ledger write and the queue ack.
 *
 * A natural key is not enough: networks reuse the original transaction id when
 * they reverse a completion, so `earn` and `reversal` for one transaction must
 * produce different keys.
 */

const sep = ':'

function part(value: string): string {
  const v = value.trim()
  if (!v) throw new Error('idempotency key part must not be empty')
  if (v.includes(sep)) throw new Error(`idempotency key part must not contain '${sep}': ${v}`)
  return v
}

export const ledgerKeys = {
  earn: (networkKey: string, externalTransactionId: string) =>
    ['earn', part(networkKey), part(externalTransactionId)].join(sep),

  screenout: (networkKey: string, externalTransactionId: string) =>
    ['screenout', part(networkKey), part(externalTransactionId)].join(sep),

  /**
   * `reversalEventId` distinguishes two partial clawbacks against the same
   * transaction. Callers pass the network's own reversal id when it supplies
   * one, and a deterministic fallback otherwise.
   */
  reversal: (networkKey: string, externalTransactionId: string, reversalEventId: string) =>
    ['reversal', part(networkKey), part(externalTransactionId), part(reversalEventId)].join(sep),

  /** The debit taken when a payout is requested, not when it is paid. */
  redeem: (payoutId: string) => ['redeem', part(payoutId)].join(sep),

  /** The credit returned when a payout is cancelled or fails. */
  redeemRefund: (payoutId: string) => ['redeem_refund', part(payoutId)].join(sep),

  referralBonus: (referrerUserId: string, refereeUserId: string) =>
    ['referral_bonus', part(referrerUserId), part(refereeUserId)].join(sep),

  /** Keyed on the earning entry, so commission is paid once per earn. */
  referralCommission: (referrerUserId: string, sourceEntryId: string) =>
    ['referral_commission', part(referrerUserId), part(sourceEntryId)].join(sep),

  /** `day` is a UTC ISO date, so a double-tap at midnight cannot double-claim. */
  dailyBonus: (userId: string, day: string) =>
    ['bonus', 'daily', part(userId), part(day)].join(sep),

  /** Admin-initiated. The client supplies the uuid so a retried form post is safe. */
  manual: (adminId: string, clientUuid: string) =>
    ['manual', part(adminId), part(clientUuid)].join(sep),
} as const
