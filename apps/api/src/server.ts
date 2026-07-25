import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { createContext } from './context'
import { registerRateLimiting } from './rate-limit'
import { registerAuthRoutes } from './routes/auth'
import { registerUserRoutes } from './routes/user'
import { registerAdminRoutes } from './routes/admin'
import { registerPostbackRoutes } from './routes/postback'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Postbacks arrive from networks whose proxies we do not control, and the
  // remote IP feeds velocity checks. In production this needs to match the
  // actual proxy topology or the IP-based fraud rules see the load balancer.
  trustProxy: true,
})

/**
 * Parse JSON but keep the raw bytes.
 *
 * Networks sign the raw body or the raw query string. If Fastify parses and
 * the adapter later re-serialises to verify a signature, key order and
 * whitespace change and every signature fails — a failure that looks exactly
 * like a wrong secret and costs days to diagnose.
 */
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body as Buffer
  const text = (body as Buffer).toString('utf8')
  if (text.length === 0) return done(null, {})
  try {
    done(null, JSON.parse(text))
  } catch {
    done(new Error('invalid JSON'), undefined)
  }
})

app.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'buffer' },
  (request, body, done) => {
    request.rawBody = body as Buffer
    done(null, Object.fromEntries(new URLSearchParams((body as Buffer).toString('utf8'))))
  },
)

const ctx = await createContext()

await app.register(cookie, { secret: process.env.SESSION_SECRET ?? 'dev-secret' })
await app.register(cors, {
  origin: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
  credentials: true,
})

// Registered before the routes so per-route `config.rateLimit` is picked up.
// Counters live in Redis: with an in-memory store, running two API instances
// would silently double every limit.
await registerRateLimiting(app, ctx.connection)

app.get('/health', async () => {
  await ctx.db.execute('SELECT 1' as never)
  return { ok: true, adapters: ctx.adapters.keys() }
})

await registerAuthRoutes(app, ctx)
await registerUserRoutes(app, ctx)
await registerAdminRoutes(app, ctx)
await registerPostbackRoutes(app, ctx)

const port = Number(process.env.API_PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })

app.log.info(`api listening on ${port}`)
app.log.info(`postback endpoints: /postback/{${ctx.adapters.keys().join('|')}}`)

const shutdown = async () => {
  await app.close()
  await ctx.connection.quit()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
