import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users } from '@app/db/schema'
import { AuthError } from '@app/core'
import type { AppContext } from '../context'
import { SESSION_COOKIE, cookieOptions, requireUser } from '../auth-hook'
import { credentialLimit, emailLimit, routeLimit } from '../rate-limit'

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  referralCode: z.string().trim().max(16).optional(),
  deviceFingerprint: z.string().max(128).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceFingerprint: z.string().max(128).optional(),
})

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/auth/signup', { config: routeLimit(credentialLimit) }, async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' })
    }

    try {
      const result = await ctx.auth.signup({
        email: parsed.data.email,
        password: parsed.data.password,
        referralCode: parsed.data.referralCode,
        ctx: {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          deviceFingerprint: parsed.data.deviceFingerprint,
        },
      })

      /**
       * Score the signup itself.
       *
       * Without this the `signup_velocity` and `duplicate_device` checks are
       * registered for the `signup` subject and never invoked — the fraud
       * dashboard implies coverage that does not exist, which is worse than
       * having no check at all.
       *
       * A flagged signup still gets an account. Signup-time signals are the
       * weakest we have (shared IP is normal on carrier NAT and campus
       * networks), so this queues a human rather than turning anyone away at
       * the door. Only an outright deny suspends, and the payout gate is where
       * the decision actually bites.
       */
      const { values: settings, version: configVersion } = await ctx.settingsService.get()
      const evaluation = await ctx.fraud.evaluate(
        {
          type: 'signup',
          userId: result.userId,
          email: parsed.data.email,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          deviceFingerprint: parsed.data.deviceFingerprint,
        },
        { db: ctx.db, settings, configVersion, log: ctx.log },
      )

      if (evaluation.verdict === 'deny') {
        await ctx.db
          .update(users)
          .set({ status: 'suspended', statusReason: `signup fraud score ${evaluation.score}` })
          .where(eq(users.id, result.userId))
        ctx.log('signup suspended at registration', {
          userId: result.userId,
          score: evaluation.score,
        })
      }

      reply.setCookie(SESSION_COOKIE, result.session.token, cookieOptions)
      return { userId: result.userId }
    } catch (error) {
      if (error instanceof AuthError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })

  app.post('/auth/login', { config: routeLimit(credentialLimit) }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' })

    try {
      const result = await ctx.auth.login({
        email: parsed.data.email,
        password: parsed.data.password,
        ctx: {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          deviceFingerprint: parsed.data.deviceFingerprint,
        },
      })

      reply.setCookie(SESSION_COOKIE, result.session.token, cookieOptions)
      return { userId: result.userId }
    } catch (error) {
      if (error instanceof AuthError) {
        const status = error.code === 'invalid_credentials' ? 401 : 403
        return reply.code(status).send({ error: error.message })
      }
      throw error
    }
  })

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await ctx.auth.logout(token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.post('/auth/password-reset/request', { config: routeLimit(emailLimit) }, async (request) => {
    const body = z.object({ email: z.string().email() }).safeParse(request.body)
    // Always returns ok, whether or not the address exists. Telling an
    // unauthenticated caller which addresses are registered is an enumeration
    // oracle, and this is the easiest endpoint to hit at scale.
    if (body.success) {
      await ctx.auth.requestPasswordReset(body.data.email, { ip: request.ip })
    }
    return { ok: true }
  })

  app.post(
    '/auth/password-reset/confirm',
    { config: routeLimit(credentialLimit) },
    async (request, reply) => {
    const body = z
      .object({ token: z.string().min(1), password: z.string().min(8) })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

      try {
        await ctx.auth.resetPassword(body.data.token, body.data.password)
        return { ok: true }
      } catch (error) {
        if (error instanceof AuthError) return reply.code(400).send({ error: error.message })
        throw error
      }
    },
  )

  app.post('/auth/verify-email', { config: routeLimit(credentialLimit) }, async (request, reply) => {
    const body = z.object({ token: z.string().min(1) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    try {
      await ctx.auth.verifyEmail(body.data.token)
      return { ok: true }
    } catch (error) {
      if (error instanceof AuthError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })

  app.get('/auth/me', { preHandler: requireUser(ctx) }, async (request) => {
    const [user] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        country: users.country,
        referralCode: users.referralCode,
        emailVerifiedAt: users.emailVerifiedAt,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, request.userId!))
      .limit(1)

    return { user }
  })
}
