import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RateLimitOptions } from '@fastify/rate-limit'

/**
 * Rate limits, tiered by what the endpoint costs us when abused.
 *
 * Three different threats, so three different shapes:
 *
 *  - **Credential endpoints** (login, signup, reset). Abused for credential
 *    stuffing and mass account creation, which is the front door for
 *    multi-accounting fraud in this category. Keyed on IP, tight.
 *
 *  - **Postbacks.** NOT tightly limited. A network settling a backlog will
 *    legitimately send hundreds of events in a burst, and dropping those loses
 *    real user credits and real revenue. The signature check already rejects
 *    anything unsigned before it reaches the queue, so the limit here exists
 *    only to stop an unbounded flood, not to police normal behaviour.
 *
 *  - **Everything else.** A generous default so a buggy client cannot spin.
 *
 * Counters live in Redis so the limit is shared across API processes. With an
 * in-memory store, running two instances would silently double every limit.
 */

export const GLOBAL_LIMIT: RateLimitOptions = {
  max: 300,
  timeWindow: '1 minute',
}

/** Login, signup, password reset, admin login. */
export const credentialLimit: RateLimitOptions = {
  max: 10,
  timeWindow: '5 minutes',
  // Message is deliberately vague: a precise "wrong password 10 times" is a
  // signal to whoever is guessing.
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Too many attempts. Please wait a few minutes and try again.',
  }),
}

/** Anything that sends mail, which costs money and can be used to harass. */
export const emailLimit: RateLimitOptions = {
  max: 5,
  timeWindow: '15 minutes',
}

/** Money movement. Deliberately far below what a real user needs. */
export const payoutLimit: RateLimitOptions = {
  max: 10,
  timeWindow: '1 hour',
}

/** Writes that create rows a human has to read. */
export const supportLimit: RateLimitOptions = {
  max: 10,
  timeWindow: '10 minutes',
}

/**
 * Postbacks. High ceiling, and keyed per network rather than per IP so one
 * busy network cannot exhaust another's budget.
 */
export const postbackLimit: RateLimitOptions = {
  max: 6_000,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) => {
    const params = request.params as { networkKey?: string }
    return `postback:${params.networkKey ?? 'unknown'}`
  },
}

/**
 * Signed-in users are keyed on their session rather than their IP.
 *
 * A shared IP is normal for this audience — carrier NAT, a college network, a
 * cyber cafe. Limiting those by IP would throttle a hundred legitimate users
 * as though they were one.
 */
export function userAwareKey(request: FastifyRequest): string {
  return request.userId ?? request.adminId ?? request.ip
}

export function routeLimit(options: RateLimitOptions) {
  return { rateLimit: options }
}

export async function registerRateLimiting(app: FastifyInstance, redis: unknown) {
  const rateLimit = (await import('@fastify/rate-limit')).default
  await app.register(rateLimit, {
    ...GLOBAL_LIMIT,
    redis: redis as never,
    // Per-route configs opt in explicitly; this is the fallback.
    keyGenerator: userAwareKey,
    // A limiter that fails closed would take the whole API down with Redis.
    // Losing rate limiting during a Redis outage is the better failure.
    skipOnError: true,
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
  })
}
