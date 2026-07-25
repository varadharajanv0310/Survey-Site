/**
 * All money math, in one place, in integers.
 *
 * Three units exist and they are never mixed up:
 *
 *   USD micros    what networks pay US. 1_000_000 = $1.00.
 *   base micros   the same value in the currency we pay users in (INR).
 *   points        what the user sees. 10 points = ₹1.
 *
 * The USD -> base step is where our FX exposure lives: networks settle in
 * dollars, users are owed rupees, and the rate between them moves. It is a
 * configured value rather than a constant precisely so it can be reviewed.
 *
 * Micros rather than minor units at ingestion because networks routinely quote
 * fractions of a cent — a survey screenout is worth $0.004 — and rounding
 * there discards real revenue across millions of events.
 */

export type CurrencyConfig = {
  /** ISO-4217 code users are paid in. */
  baseCurrency: string
  /** Points per 1 unit of base currency. 10 => 10 points per rupee. */
  pointsPerUnit: number
  /** Base-currency units per USD. */
  usdToBaseRate: number
  /** Minor units per major unit. 100 paise per rupee. */
  minorUnitsPerMajor: number
}

/** Pull the currency config out of settings without every caller knowing the keys. */
export function currencyConfig(settings: {
  base_currency: string
  points_per_currency_unit: number
  usd_to_base_rate: number
  currency_minor_units: number
}): CurrencyConfig {
  return {
    baseCurrency: settings.base_currency,
    pointsPerUnit: settings.points_per_currency_unit,
    usdToBaseRate: settings.usd_to_base_rate,
    minorUnitsPerMajor: settings.currency_minor_units,
  }
}

/** What the user is owed from a gross network payout, still in USD micros. */
export function userShareMicros(grossUsdMicros: number, revenueShareBps: number): number {
  if (!Number.isInteger(grossUsdMicros)) throw new Error('grossUsdMicros must be an integer')
  if (revenueShareBps < 0 || revenueShareBps > 10_000) {
    throw new Error(`revenueShareBps out of range: ${revenueShareBps}`)
  }
  // Floor, so rounding error accrues to us rather than against us. At micro
  // granularity this is at most $0.000001 per event.
  return Math.floor((grossUsdMicros * (10_000 - revenueShareBps)) / 10_000)
}

/** USD micros -> base-currency micros, at the configured rate. */
export function usdMicrosToBaseMicros(usdMicros: number, currency: CurrencyConfig): number {
  return Math.floor(usdMicros * currency.usdToBaseRate)
}

/**
 * Base-currency micros -> displayed points.
 *
 * `minAwardPoints` exists because flooring a ₹0.19 screenout gives 0 points,
 * and a user who completes something and receives nothing files a support
 * ticket that costs more than the points would have.
 */
export function pointsForBaseMicros(
  baseMicros: number,
  currency: CurrencyConfig,
  minAwardPoints = 1,
): number {
  if (baseMicros <= 0) return 0
  const points = Math.floor((baseMicros * currency.pointsPerUnit) / 1_000_000)
  return Math.max(points, minAwardPoints)
}

/** The full gross-USD -> points path, which is what callers actually want. */
export function awardPoints(args: {
  grossUsdMicros: number
  revenueShareBps: number
  currency: CurrencyConfig
  minAwardPoints?: number
}): number {
  const userUsd = userShareMicros(args.grossUsdMicros, args.revenueShareBps)
  const userBase = usdMicrosToBaseMicros(userUsd, args.currency)
  return pointsForBaseMicros(userBase, args.currency, args.minAwardPoints ?? 1)
}

/** Points -> payable amount in minor units (paise). Used at redemption. */
export function minorUnitsForPoints(points: number, currency: CurrencyConfig): number {
  if (points <= 0) return 0
  // Floor: we never pay out more than the points are worth.
  return Math.floor((points * currency.minorUnitsPerMajor) / currency.pointsPerUnit)
}

/** Points -> base-currency micros. For display and reporting. */
export function baseMicrosForPoints(points: number, currency: CurrencyConfig): number {
  return Math.floor((points * 1_000_000) / currency.pointsPerUnit)
}

/**
 * Our margin on a completion, expressed in USD micros so it reconciles against
 * what the network actually invoices us.
 */
export function marginUsdMicros(args: {
  grossUsdMicros: number
  pointsAwarded: number
  currency: CurrencyConfig
}): number {
  const owedBaseMicros = baseMicrosForPoints(args.pointsAwarded, args.currency)
  const owedUsdMicros = Math.floor(owedBaseMicros / args.currency.usdToBaseRate)
  return args.grossUsdMicros - owedUsdMicros
}
