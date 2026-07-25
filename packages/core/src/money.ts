/**
 * All money math, in one place, in integers.
 *
 * Two units exist and they are never mixed up:
 *   - USD micros: what networks pay us. 1_000_000 = $1.00.
 *   - points:     what the user sees. `points_per_usd` converts between them.
 *
 * Micros rather than cents because networks routinely quote fractions of a
 * cent — a survey screenout is worth $0.004 — and rounding at ingestion
 * discards real revenue across millions of events.
 */

/** What the user is owed from a gross network payout, before conversion. */
export function userShareMicros(grossUsdMicros: number, revenueShareBps: number): number {
  if (!Number.isInteger(grossUsdMicros)) throw new Error('grossUsdMicros must be an integer')
  if (revenueShareBps < 0 || revenueShareBps > 10_000) {
    throw new Error(`revenueShareBps out of range: ${revenueShareBps}`)
  }
  // Floor, so rounding error accrues to us rather than against us. At micro
  // granularity this is at most $0.000001 per event.
  return Math.floor((grossUsdMicros * (10_000 - revenueShareBps)) / 10_000)
}

/**
 * Convert the user's share into displayed points.
 *
 * `minAwardPoints` exists because flooring a $0.003 screenout gives 0 points,
 * and a user who completes something and receives nothing files a support
 * ticket that costs more than the points would have.
 */
export function pointsForMicros(
  userMicros: number,
  pointsPerUsd: number,
  minAwardPoints = 1,
): number {
  if (userMicros <= 0) return 0
  const points = Math.floor((userMicros * pointsPerUsd) / 1_000_000)
  return Math.max(points, minAwardPoints)
}

/** The full gross -> points path, which is what callers actually want. */
export function awardPoints(args: {
  grossUsdMicros: number
  revenueShareBps: number
  pointsPerUsd: number
  minAwardPoints?: number
}): number {
  return pointsForMicros(
    userShareMicros(args.grossUsdMicros, args.revenueShareBps),
    args.pointsPerUsd,
    args.minAwardPoints ?? 1,
  )
}

/** Points -> payable amount, in minor units (cents, paise). Used at redemption. */
export function minorUnitsForPoints(
  points: number,
  pointsPerUsd: number,
  minorUnitsPerMajor = 100,
): number {
  if (points <= 0) return 0
  // Floor: we never pay out more than the points are worth.
  return Math.floor((points * minorUnitsPerMajor) / pointsPerUsd)
}

/** Our gross margin on a completion, in micros. Feeds per-network reporting. */
export function marginMicros(args: {
  grossUsdMicros: number
  pointsAwarded: number
  pointsPerUsd: number
}): number {
  const paidToUserMicros = Math.floor((args.pointsAwarded * 1_000_000) / args.pointsPerUsd)
  return args.grossUsdMicros - paidToUserMicros
}
