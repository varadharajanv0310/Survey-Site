import { sql } from 'drizzle-orm'
import type { CheckOutcome, FraudCheck, FraudContext, FraudSubject } from './types'

const one = async <T>(ctx: FraudContext, query: ReturnType<typeof sql>): Promise<T | undefined> => {
  const rows = (await ctx.db.execute(query)) as unknown as T[]
  return rows[0]
}

/**
 * Too many completions from one account in an hour.
 *
 * The honest limitation: a genuinely engaged user on a good day can trip this.
 * That is why it scores toward review rather than denying — the cost of
 * wrongly denying a real user's earnings is losing the user, and the cost of
 * reviewing them is a few seconds of someone's attention.
 */
export const userCompletionVelocity: FraudCheck = {
  key: 'user_completion_velocity',
  appliesTo: ['completion'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    if (subject.type !== 'completion') return { verdict: 'allow', scoreDelta: 0 }

    const row = await one<{ n: string }>(
      ctx,
      sql`SELECT count(*)::TEXT AS n FROM completions
          WHERE user_id = ${subject.userId}
            AND received_at > now() - interval '1 hour'`,
    )
    const count = Number(row?.n ?? 0)
    const cap = ctx.settings.max_completions_per_user_per_hour

    if (count <= cap) return { verdict: 'allow', scoreDelta: 0, details: { count, cap } }

    // Scale with the overage instead of a cliff: 26 completions against a cap
    // of 25 is noise, 200 is not.
    const overage = count - cap
    return {
      verdict: overage > cap ? 'deny' : 'review',
      scoreDelta: Math.min(60, 20 + overage * 2),
      details: { count, cap, overage },
    }
  },
}

/** Many accounts completing offers from a single IP. */
export const ipCompletionVelocity: FraudCheck = {
  key: 'ip_completion_velocity',
  appliesTo: ['completion'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    if (subject.type !== 'completion' || !subject.ip) {
      return { verdict: 'allow', scoreDelta: 0 }
    }

    const row = await one<{ n: string; users: string }>(
      ctx,
      sql`SELECT count(*)::TEXT AS n, count(DISTINCT user_id)::TEXT AS users
          FROM completions
          WHERE ip = ${subject.ip}::inet
            AND received_at > now() - interval '1 hour'`,
    )
    const count = Number(row?.n ?? 0)
    const distinctUsers = Number(row?.users ?? 0)
    const cap = ctx.settings.max_completions_per_ip_per_hour

    // Shared IPs are ordinary — universities, offices, mobile carrier NAT, a
    // whole apartment block behind one CGNAT address. Volume alone is weak
    // evidence; volume *and* many distinct accounts is much stronger.
    let score = 0
    if (count > cap) score += 15
    if (distinctUsers >= 5) score += 25
    if (distinctUsers >= 15) score += 30

    if (score === 0) return { verdict: 'allow', scoreDelta: 0, details: { count, distinctUsers } }
    return {
      verdict: score >= 55 ? 'deny' : 'review',
      scoreDelta: score,
      details: { count, distinctUsers, cap },
    }
  },
}

/**
 * Several accounts sharing one device fingerprint.
 *
 * Weaker than a shared payout destination but far stronger than a shared IP:
 * families share addresses, they rarely share a browser fingerprint.
 */
export const duplicateDevice: FraudCheck = {
  key: 'duplicate_device',
  appliesTo: ['signup', 'login', 'completion', 'payout'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    const fingerprint =
      subject.type === 'signup' || subject.type === 'login' ? subject.deviceFingerprint : undefined
    if (!fingerprint) return { verdict: 'allow', scoreDelta: 0 }

    const row = await one<{ n: string }>(
      ctx,
      sql`SELECT count(DISTINCT user_id)::TEXT AS n FROM user_devices
          WHERE fingerprint = ${fingerprint}`,
    )
    const accounts = Number(row?.n ?? 0)
    if (accounts <= 1) return { verdict: 'allow', scoreDelta: 0, details: { accounts } }
    if (accounts === 2) return { verdict: 'allow', scoreDelta: 15, details: { accounts } }
    return {
      verdict: accounts >= 5 ? 'deny' : 'review',
      scoreDelta: Math.min(70, accounts * 12),
      details: { accounts },
    }
  },
}

/** Too many accounts created from one IP in a day. */
export const signupVelocity: FraudCheck = {
  key: 'signup_velocity',
  appliesTo: ['signup'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    if (subject.type !== 'signup' || !subject.ip) return { verdict: 'allow', scoreDelta: 0 }

    const row = await one<{ n: string }>(
      ctx,
      sql`SELECT count(*)::TEXT AS n FROM users
          WHERE signup_ip = ${subject.ip}::inet
            AND created_at > now() - interval '1 day'`,
    )
    const count = Number(row?.n ?? 0)
    const cap = ctx.settings.max_signups_per_ip_per_day
    if (count <= cap) return { verdict: 'allow', scoreDelta: 0, details: { count, cap } }
    return {
      verdict: count > cap * 3 ? 'deny' : 'review',
      scoreDelta: Math.min(60, (count - cap) * 10),
      details: { count, cap },
    }
  },
}

/**
 * The strongest multi-accounting signal we have.
 *
 * Twelve accounts cashing out to one PayPal address is not a coincidence, in a
 * way that a shared IP or even a shared device never quite is. This is checked
 * at payout, which is also where fraud actually costs us cash rather than
 * margin.
 */
export const payoutDestinationReuse: FraudCheck = {
  key: 'payout_destination_reuse',
  appliesTo: ['payout'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    if (subject.type !== 'payout') return { verdict: 'allow', scoreDelta: 0 }

    const row = await one<{ n: string }>(
      ctx,
      sql`SELECT count(DISTINCT user_id)::TEXT AS n FROM payouts
          WHERE destination_hash = ${subject.destinationHash}
            AND user_id <> ${subject.userId}`,
    )
    const others = Number(row?.n ?? 0)
    if (others === 0) return { verdict: 'allow', scoreDelta: 0, details: { otherAccounts: 0 } }
    if (others === 1) {
      // Couples and families genuinely share one PayPal account.
      return { verdict: 'review', scoreDelta: 30, details: { otherAccounts: others } }
    }
    return { verdict: 'deny', scoreDelta: 100, details: { otherAccounts: others } }
  },
}

/** First payout from a young account, cashing out unusually fast. */
export const newAccountPayout: FraudCheck = {
  key: 'new_account_payout',
  appliesTo: ['payout'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    if (subject.type !== 'payout') return { verdict: 'allow', scoreDelta: 0 }

    const row = await one<{ age_hours: string; prior_payouts: string; verified: string }>(
      ctx,
      sql`SELECT
            EXTRACT(EPOCH FROM (now() - u.created_at)) / 3600 AS age_hours,
            (SELECT count(*) FROM payouts p WHERE p.user_id = u.id AND p.state = 'paid')::TEXT AS prior_payouts,
            (u.email_verified_at IS NOT NULL)::TEXT AS verified
          FROM users u WHERE u.id = ${subject.userId}`,
    )

    const ageHours = Number(row?.age_hours ?? 999)
    const priorPayouts = Number(row?.prior_payouts ?? 0)
    const verified = row?.verified === 'true'

    let score = 0
    const details: Record<string, unknown> = { ageHours: Math.round(ageHours), priorPayouts, verified }

    if (priorPayouts === 0 && ctx.settings.review_first_payout) score += 25
    if (ageHours < 24) score += 30
    if (!verified) score += 25
    if (subject.points >= ctx.settings.review_payout_above_points) score += 20

    if (score === 0) return { verdict: 'allow', scoreDelta: 0, details }
    return { verdict: score >= 70 ? 'deny' : 'review', scoreDelta: score, details }
  },
}

/**
 * Proxy / VPN / datacentre detection.
 *
 * Deliberately not implemented against a provider yet — there is no
 * IPQualityScore or MaxMind account. Rather than pretending to check, it
 * reports `unavailable`, which the pipeline resolves using the configured
 * fail mode. When the account exists, this becomes an HTTP call and nothing
 * else in the system changes.
 */
export const proxyDetection: FraudCheck = {
  key: 'proxy_detection',
  appliesTo: ['signup', 'completion', 'payout'],
  timeoutMs: 3_000,
  async evaluate(_subject, ctx): Promise<CheckOutcome> {
    if (!process.env.IPQS_API_KEY && !process.env.MAXMIND_LICENSE_KEY) {
      return {
        verdict: 'unavailable',
        scoreDelta: 0,
        details: { reason: 'no proxy-detection provider configured' },
      }
    }
    ctx.log('proxy_detection: provider configured but the integration is not built yet')
    return { verdict: 'unavailable', scoreDelta: 0, details: { reason: 'not implemented' } }
  },
}

/** A completion worth far more than that network's normal event. */
export const anomalousPayout: FraudCheck = {
  key: 'anomalous_payout',
  appliesTo: ['completion'],
  async evaluate(subject, ctx): Promise<CheckOutcome> {
    if (subject.type !== 'completion') return { verdict: 'allow', scoreDelta: 0 }

    const row = await one<{ p95: string | null; n: string }>(
      ctx,
      sql`SELECT
            percentile_cont(0.95) WITHIN GROUP (ORDER BY gross_usd_micros)::TEXT AS p95,
            count(*)::TEXT AS n
          FROM completions
          WHERE network_id = ${subject.networkId}
            AND kind = 'credit'
            AND received_at > now() - interval '30 days'`,
    )

    const sampleSize = Number(row?.n ?? 0)
    // Below a few hundred events the percentile is noise, not a baseline.
    if (sampleSize < 200 || !row?.p95) {
      return { verdict: 'allow', scoreDelta: 0, details: { sampleSize, reason: 'insufficient history' } }
    }

    const p95 = Number(row.p95)
    if (subject.grossUsdMicros <= p95 * 3) {
      return { verdict: 'allow', scoreDelta: 0, details: { p95, sampleSize } }
    }

    return {
      verdict: 'review',
      scoreDelta: 35,
      details: { p95, gross: subject.grossUsdMicros, sampleSize },
    }
  },
}

export const DEFAULT_CHECKS: FraudCheck[] = [
  userCompletionVelocity,
  ipCompletionVelocity,
  duplicateDevice,
  signupVelocity,
  payoutDestinationReuse,
  newAccountPayout,
  anomalousPayout,
  proxyDetection,
]
