import { createHash, timingSafeEqual } from 'node:crypto'
import {
  PostbackParseError,
  usdStringToMicros,
  type AdapterContext,
  type CanonicalCompletion,
  type CanonicalOffer,
  type NetworkAdapter,
  type PostbackVerification,
  type RawPostback,
} from './types'

/**
 * Offer wall, modelled on the conventions AdGate Media, Adscend, OfferToro and
 * Torox actually use:
 *
 *   - GET postback with everything in the query string
 *   - signature is md5(transaction_id + secret), lowercase hex
 *   - `status=1` credit, `status=2` reversal
 *   - `payout` is a decimal dollar string
 *   - a catalog endpoint returning offers filtered by country and device
 *
 * Only the transport is fake. When a real offer-wall account lands, this file
 * gets its field names swapped and points at a real URL; nothing else moves.
 *
 * md5 is not a defensible choice in 2026, but several of these networks
 * genuinely still use it, and an adapter that refuses to speak the protocol
 * the network speaks is not an adapter. It is compared in constant time and
 * scoped to signature verification only.
 */
export class SimOfferWallAdapter implements NetworkAdapter {
  readonly key = 'sim_offer_wall'
  readonly kind = 'offer_wall' as const
  readonly capabilities = {
    catalog: true,
    placements: false,
    postbacks: true,
    reversals: true,
  }

  async fetchOffers(ctx: AdapterContext): Promise<CanonicalOffer[]> {
    // A real adapter fetches here. There is no network account yet, and the
    // brief was explicit that nothing may pretend to have one, so this returns
    // a deterministic catalog and says so.
    ctx.log('sim_offer_wall: serving local catalog (no real network account configured)')
    return SIM_CATALOG.map((offer) => ({ ...offer, raw: { source: 'simulator', ...offer } }))
  }

  verifyPostback(raw: RawPostback, ctx: AdapterContext): PostbackVerification {
    if (!ctx.secret) return { ok: false, reason: 'no secret configured for this network' }

    const provided = raw.query.signature ?? raw.query.hash
    if (!provided) return { ok: false, reason: 'missing signature parameter' }

    const txId = raw.query.transaction_id
    if (!txId) return { ok: false, reason: 'missing transaction_id' }

    const expected = createHash('md5').update(`${txId}${ctx.secret}`).digest('hex')

    const a = Buffer.from(provided.toLowerCase())
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'signature mismatch' }
    }
    return { ok: true }
  }

  parsePostback(raw: RawPostback): CanonicalCompletion {
    const q = raw.query

    const externalTransactionId = q.transaction_id
    if (!externalTransactionId) throw new PostbackParseError('missing transaction_id', 'malformed')

    const userToken = q.sub_id ?? q.aff_sub
    if (!userToken) throw new PostbackParseError('missing sub_id', 'malformed')

    const status = q.status ?? '1'
    const kind = status === '2' ? 'reversal' : 'credit'

    const grossUsdMicros = Math.abs(usdStringToMicros(q.payout))

    const occurredAtRaw = q.timestamp ? Number(q.timestamp) : undefined
    const occurredAt =
      occurredAtRaw && Number.isFinite(occurredAtRaw) ? new Date(occurredAtRaw * 1000) : undefined

    return {
      kind,
      externalTransactionId,
      // Networks that do not supply a reversal id force us to derive one.
      // Deriving it from the transaction id alone would collapse two partial
      // clawbacks into one, so the amount is folded in.
      ...(kind === 'reversal'
        ? { reversalEventId: q.reversal_id ?? `derived-${q.payout ?? '0'}` }
        : {}),
      userToken,
      ...(q.offer_id ? { externalOfferId: q.offer_id } : {}),
      grossUsdMicros,
      ...(occurredAt ? { occurredAt } : {}),
      ...(q.user_ip ? { ip: q.user_ip } : {}),
      raw: { ...q },
    }
  }
}

const SIM_CATALOG: Omit<CanonicalOffer, 'raw'>[] = [
  {
    externalOfferId: 'sow-1001',
    title: 'Coin Master — reach village 5',
    description: 'Install and play until you unlock village 5.',
    requirements: 'New users only. Must reach village 5 within 7 days.',
    category: 'game',
    grossUsdMicros: 4_200_000,
    urlTemplate: 'https://sim-offer-wall.local/click?offer=sow-1001&sub_id={user_token}',
    countries: ['US', 'CA', 'GB', 'AU'],
    devices: ['mobile'],
    estimatedMinutes: 90,
  },
  {
    externalOfferId: 'sow-1002',
    title: 'MyPoints — complete registration',
    description: 'Sign up and confirm your email address.',
    requirements: 'Email confirmation required.',
    category: 'signup',
    grossUsdMicros: 1_150_000,
    urlTemplate: 'https://sim-offer-wall.local/click?offer=sow-1002&sub_id={user_token}',
    countries: ['US'],
    devices: ['desktop', 'mobile'],
    estimatedMinutes: 5,
  },
  {
    externalOfferId: 'sow-1003',
    title: 'Temu — first order',
    description: 'Place an order of $5 or more.',
    requirements: 'New customers only. Order must not be cancelled.',
    category: 'purchase',
    grossUsdMicros: 12_500_000,
    urlTemplate: 'https://sim-offer-wall.local/click?offer=sow-1003&sub_id={user_token}',
    countries: ['US', 'GB', 'DE', 'IN'],
    devices: ['desktop', 'mobile', 'tablet'],
    estimatedMinutes: 15,
  },
  {
    externalOfferId: 'sow-1004',
    title: 'Solitaire Cash — play 3 games',
    category: 'game',
    description: 'Install and complete three rounds.',
    grossUsdMicros: 850_000,
    urlTemplate: 'https://sim-offer-wall.local/click?offer=sow-1004&sub_id={user_token}',
    countries: ['US', 'IN'],
    devices: ['mobile'],
    estimatedMinutes: 20,
  },
  {
    externalOfferId: 'sow-1005',
    title: 'Streaming trial — 7 days',
    description: 'Start a free trial with a valid payment method.',
    requirements: 'Card required. Cancels within 7 days are reversed.',
    category: 'signup',
    grossUsdMicros: 8_000_000,
    urlTemplate: 'https://sim-offer-wall.local/click?offer=sow-1005&sub_id={user_token}',
    countries: ['US', 'CA'],
    devices: ['desktop', 'mobile'],
    estimatedMinutes: 10,
  },
  {
    externalOfferId: 'sow-1006',
    title: 'Grocery app — install and open',
    category: 'app_install',
    grossUsdMicros: 320_000,
    urlTemplate: 'https://sim-offer-wall.local/click?offer=sow-1006&sub_id={user_token}',
    countries: ['IN'],
    devices: ['mobile'],
    estimatedMinutes: 3,
  },
]
