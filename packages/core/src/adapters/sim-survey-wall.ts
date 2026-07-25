import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  PostbackParseError,
  usdStringToMicros,
  type AdapterContext,
  type CanonicalCompletion,
  type NetworkAdapter,
  type PlacementUser,
  type PostbackVerification,
  type RawPostback,
} from './types'

/**
 * Survey wall, modelled on CPX Research / BitLabs / TheoremReach conventions:
 *
 *   - no catalog. The wall is an iframe; its own JS decides what to show, in
 *     real time, based on the user's profile and current demand.
 *   - the placement URL carries an app id and a signed user identifier
 *   - the postback signature is an HMAC over the raw query string, so the
 *     order of parameters matters and re-serialising breaks it
 *   - three outcomes, not one: complete, screenout, reversal
 *
 * The screenout case is why survey walls cannot reuse the offer-wall shape.
 * Most survey attempts end in disqualification, the wall pays a few cents for
 * it, and a model that only understands completion drops the majority of its
 * events on the floor.
 */
export class SimSurveyWallAdapter implements NetworkAdapter {
  readonly key = 'sim_survey_wall'
  readonly kind = 'survey_wall' as const
  readonly capabilities = {
    catalog: false, // deliberately: there is nothing to sync
    placements: true,
    postbacks: true,
    reversals: true,
  }

  buildPlacementUrl(ctx: AdapterContext, user: PlacementUser): string {
    const appId = String(ctx.config.app_id ?? 'sim-app')
    const base = String(ctx.config.wall_url ?? 'https://sim-survey-wall.local/wall')

    const params = new URLSearchParams({
      app_id: appId,
      ext_user_id: user.userToken,
      ...(user.country ? { country: user.country } : {}),
      ...(user.device ? { device: user.device } : {}),
    })

    // The wall verifies this so it knows the request came from us.
    if (ctx.secret) {
      const secure = createHmac('sha256', ctx.secret)
        .update(`${appId}${user.userToken}`)
        .digest('hex')
      params.set('secure_hash', secure)
    }

    return `${base}?${params.toString()}`
  }

  verifyPostback(raw: RawPostback, ctx: AdapterContext): PostbackVerification {
    if (!ctx.secret) return { ok: false, reason: 'no secret configured for this network' }

    const provided = raw.query.secure_hash
    if (!provided) return { ok: false, reason: 'missing secure_hash' }

    /**
     * Signed over the raw query string with the signature parameter removed,
     * order preserved. This is why `RawPostback` carries `rawQueryString`: if
     * we rebuilt the string from a parsed object, URLSearchParams would
     * re-encode and reorder it and every signature would fail.
     */
    const signable = raw.rawQueryString
      .split('&')
      .filter((pair) => !pair.startsWith('secure_hash='))
      .join('&')

    const expected = createHmac('sha256', ctx.secret).update(signable).digest('hex')

    const a = Buffer.from(provided.toLowerCase())
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'secure_hash mismatch' }
    }
    return { ok: true }
  }

  parsePostback(raw: RawPostback): CanonicalCompletion {
    const q = raw.query

    const externalTransactionId = q.trans_id
    if (!externalTransactionId) throw new PostbackParseError('missing trans_id', 'malformed')

    const userToken = q.ext_user_id
    if (!userToken) throw new PostbackParseError('missing ext_user_id', 'malformed')

    // 1 = completed, 2 = screened out, 3 = reversed/chargeback
    const status = q.status ?? '1'
    const kind = status === '3' ? 'reversal' : status === '2' ? 'screenout' : 'credit'

    const grossUsdMicros = Math.abs(usdStringToMicros(q.amount_usd))

    return {
      kind,
      externalTransactionId,
      ...(kind === 'reversal'
        ? { reversalEventId: q.reversal_id ?? `derived-${q.amount_usd ?? '0'}` }
        : {}),
      userToken,
      ...(q.survey_id ? { externalOfferId: q.survey_id } : {}),
      grossUsdMicros,
      ...(q.ip ? { ip: q.ip } : {}),
      raw: { ...q },
    }
  }
}
