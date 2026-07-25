/**
 * The canonical shapes. Nothing outside `adapters/` ever sees a
 * network-specific field name.
 *
 * The value of this boundary is not tidiness. It is that adding CPX Research
 * or AdGate later becomes one new file implementing `NetworkAdapter`, with no
 * edits to the ledger, the fraud pipeline, the worker or the frontend.
 */

export type OfferCategory =
  | 'survey'
  | 'app_install'
  | 'signup'
  | 'purchase'
  | 'game'
  | 'video'
  | 'other'

export type Device = 'desktop' | 'mobile' | 'tablet'

/** Offer-wall inventory. Survey walls do not produce these — see `buildPlacementUrl`. */
export type CanonicalOffer = {
  externalOfferId: string
  title: string
  description?: string
  requirements?: string
  category: OfferCategory
  iconUrl?: string
  /** What the network pays US, in USD micros. Never what the user receives. */
  grossUsdMicros: number
  /** May contain `{user_token}`, substituted per user at render time. */
  urlTemplate: string
  countries?: string[]
  excludedCountries?: string[]
  devices?: Device[]
  estimatedMinutes?: number
  raw: unknown
}

/**
 * An inbound postback exactly as it arrived.
 *
 * `rawBody` is a Buffer and stays one. Most networks sign the raw bytes or the
 * raw query string, so parsing and re-serialising JSON before the adapter sees
 * it changes key order and whitespace and breaks signatures in ways that look
 * like credential problems for days.
 */
export type RawPostback = {
  method: string
  path: string
  query: Record<string, string>
  /** The query string verbatim, before any parsing. Some signatures cover this. */
  rawQueryString: string
  headers: Record<string, string>
  rawBody: Buffer
  remoteIp: string
}

export type PostbackVerification = { ok: true } | { ok: false; reason: string }

/**
 * What a network is telling us happened.
 *
 * `kind` covers all three real cases. `screenout` is not an edge case: users
 * are disqualified from most survey attempts and walls pay a small consolation
 * amount, so it is the single most common event we receive.
 */
export type CanonicalCompletion = {
  kind: 'credit' | 'screenout' | 'reversal'
  externalTransactionId: string
  /**
   * Distinguishes two clawbacks against one transaction. Networks reuse the
   * original transaction id when reversing, so without this a second partial
   * clawback silently deduplicates against the first.
   */
  reversalEventId?: string
  /** The signed token we handed the wall. Adapters never resolve it to a user. */
  userToken: string
  externalOfferId?: string
  grossUsdMicros: number
  occurredAt?: Date
  ip?: string
  userAgent?: string
  raw: unknown
}

export type AdapterContext = {
  /** Resolved from the env var named by `networks.secret_ref`. */
  secret: string | undefined
  config: Record<string, unknown>
  log: (message: string, meta?: Record<string, unknown>) => void
}

export type PlacementUser = {
  userToken: string
  country?: string | undefined
  device?: Device | undefined
}

/**
 * Adapters translate and verify. They do not touch the database, resolve
 * users, award points, or decide anything.
 *
 * That restriction is what keeps a future "integrate CPX" session from turning
 * into a business-logic session.
 */
export interface NetworkAdapter {
  readonly key: string
  readonly kind: 'survey_wall' | 'offer_wall'
  readonly capabilities: {
    /** Has a fetchable offer catalog. Offer walls do; survey walls do not. */
    catalog: boolean
    /** Renders as a signed iframe URL. Survey walls do; offer walls may. */
    placements: boolean
    postbacks: boolean
    reversals: boolean
  }

  fetchOffers?(ctx: AdapterContext): Promise<CanonicalOffer[]>
  buildPlacementUrl?(ctx: AdapterContext, user: PlacementUser): string

  verifyPostback(raw: RawPostback, ctx: AdapterContext): PostbackVerification
  parsePostback(raw: RawPostback, ctx: AdapterContext): CanonicalCompletion
}

export class PostbackParseError extends Error {
  constructor(
    message: string,
    readonly kind: 'malformed' | 'unsupported',
  ) {
    super(message)
    this.name = 'PostbackParseError'
  }
}

/** Networks quote dollars as decimal strings. Parse once, here, in integers. */
export function usdStringToMicros(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') {
    throw new PostbackParseError('missing payout amount', 'malformed')
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    throw new PostbackParseError(`payout amount is not a number: ${String(value)}`, 'malformed')
  }
  // Round rather than truncate: 0.07 in binary floating point is 0.0699999...,
  // and truncating would quietly shave a micro off a large share of events.
  return Math.round(n * 1_000_000)
}
