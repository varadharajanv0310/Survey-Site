import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppContext } from './context'

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
    adminId?: string
    rawBody?: Buffer
  }
}

export const SESSION_COOKIE = 'sid'
export const ADMIN_COOKIE = 'asid'

/**
 * Session status is re-read from the database on every request, so banning an
 * account takes effect immediately rather than whenever its token expires.
 * That property is the reason these are opaque sessions and not JWTs.
 */
export function requireUser(ctx: AppContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return reply.code(401).send({ error: 'not signed in' })

    const session = await ctx.auth.validateSession(token)
    if (!session) return reply.code(401).send({ error: 'session expired' })
    if (session.status !== 'active') {
      return reply.code(403).send({ error: `account is ${session.status}` })
    }

    request.userId = session.userId
  }
}

/**
 * Admin auth is separate from user auth all the way down — different table,
 * different cookie, different validation path. A bug that confuses a user
 * session for an admin one should not be expressible.
 */
export function requireAdmin(ctx: AppContext, minimumRole: 'viewer' | 'reviewer' | 'superadmin' = 'viewer') {
  const rank = { viewer: 0, reviewer: 1, superadmin: 2 }
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[ADMIN_COOKIE]
    if (!token) return reply.code(401).send({ error: 'not signed in' })

    const admin = await ctx.adminAuth.validate(token)
    if (!admin) return reply.code(401).send({ error: 'session expired' })
    if (rank[admin.role] < rank[minimumRole]) {
      return reply.code(403).send({ error: `requires ${minimumRole}` })
    }

    request.adminId = admin.id
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 3600,
}
