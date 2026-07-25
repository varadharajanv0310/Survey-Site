import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  completions,
  ledgerEntries,
  networks,
  payouts,
  reviewItems,
  settings as settingsTable,
  ticketMessages,
  tickets,
  users,
} from '@app/db/schema'
import { ledgerKeys, queueJobId, type SettingsShape } from '@app/core'
import type { AppContext } from '../context'
import { ADMIN_COOKIE, cookieOptions, requireAdmin } from '../auth-hook'

export async function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const viewer = { preHandler: requireAdmin(ctx, 'viewer') }
  const reviewer = { preHandler: requireAdmin(ctx, 'reviewer') }
  const superadmin = { preHandler: requireAdmin(ctx, 'superadmin') }

  app.post('/admin/login', async (request, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const result = await ctx.adminAuth.login(body.data.email, body.data.password, request.ip)
    if (!result) return reply.code(401).send({ error: 'email or password is incorrect' })

    reply.setCookie(ADMIN_COOKIE, result.token, { ...cookieOptions, maxAge: 12 * 3600 })
    return { role: result.role }
  })

  app.post('/admin/logout', async (request, reply) => {
    const token = request.cookies[ADMIN_COOKIE]
    if (token) await ctx.adminAuth.logout(token)
    reply.clearCookie(ADMIN_COOKIE, { path: '/' })
    return { ok: true }
  })

  // --- users ---------------------------------------------------------------

  app.get('/admin/users', viewer, async (request) => {
    const query = z
      .object({
        search: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(request.query)

    // Balances come from the view, so the admin list and the user's own screen
    // can never disagree about what someone has.
    const rows = (await ctx.db.execute(sql`
      SELECT u.id, u.email, u.status, u.country, u.created_at, u.email_verified_at,
             u.referral_code,
             b.posted_points::TEXT       AS posted,
             b.withdrawable_points::TEXT AS withdrawable,
             b.pending_points::TEXT      AS pending,
             b.lifetime_earned_points::TEXT AS lifetime_earned
      FROM users u
      JOIN user_balances b ON b.user_id = u.id
      ${query.search ? sql`WHERE u.email ILIKE ${'%' + query.search + '%'}` : sql``}
      ORDER BY u.created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `)) as unknown as Record<string, string>[]

    return { users: rows }
  })

  app.get('/admin/users/:id', viewer, async (request, reply) => {
    const { id } = request.params as { id: string }

    const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!user) return reply.code(404).send({ error: 'not found' })

    const balance = await ctx.ledger.getBalance(id)

    const entries = await ctx.db
      .select({
        id: ledgerEntries.id,
        amountPoints: ledgerEntries.amountPoints,
        type: ledgerEntries.type,
        status: ledgerEntries.status,
        availableAt: ledgerEntries.availableAt,
        note: ledgerEntries.note,
        externalTransactionId: ledgerEntries.externalTransactionId,
        createdAt: ledgerEntries.createdAt,
        networkName: networks.name,
      })
      .from(ledgerEntries)
      .leftJoin(networks, eq(networks.id, ledgerEntries.networkId))
      .where(eq(ledgerEntries.userId, id))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(200)

    const userPayouts = await ctx.db
      .select()
      .from(payouts)
      .where(eq(payouts.userId, id))
      .orderBy(desc(payouts.requestedAt))
      .limit(50)

    return { user: { ...user, passwordHash: undefined }, balance, entries, payouts: userPayouts }
  })

  app.post('/admin/users/:id/status', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        status: z.enum(['active', 'suspended', 'banned']),
        reason: z.string().min(3).max(500),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const [before] = await ctx.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!before) return reply.code(404).send({ error: 'not found' })

    await ctx.db
      .update(users)
      .set({ status: body.data.status, statusReason: body.data.reason })
      .where(eq(users.id, id))

    // A banned user must lose access now, not when their token expires.
    if (body.data.status !== 'active') await ctx.auth.revokeAllSessions(id)

    await ctx.adminAuth.audit({
      adminId: request.adminId!,
      action: 'user.status',
      subjectType: 'user',
      subjectId: id,
      before,
      after: { status: body.data.status },
      reason: body.data.reason,
      ip: request.ip,
    })

    return { ok: true }
  })

  /**
   * Manual balance adjustment.
   *
   * Goes through the ledger like everything else — a new signed row with an
   * admin attribution and a mandatory reason. There is no path that edits an
   * existing balance, because there is no balance to edit.
   */
  app.post('/admin/users/:id/adjust', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        points: z.number().int().refine((n) => n !== 0, 'amount must not be zero'),
        reason: z.string().min(3).max(500),
        clientUuid: z.string().uuid(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const entry = await ctx.ledger.record({
      userId: id,
      amountPoints: body.data.points,
      type: 'manual_adjustment',
      // The client supplies the uuid, so a double-submitted form adjusts once.
      idempotencyKey: ledgerKeys.manual(request.adminId!, body.data.clientUuid),
      note: body.data.reason,
      createdByAdminId: request.adminId!,
    })

    await ctx.adminAuth.audit({
      adminId: request.adminId!,
      action: 'user.adjust',
      subjectType: 'user',
      subjectId: id,
      after: { points: body.data.points, entryId: entry.entry.id },
      reason: body.data.reason,
      ip: request.ip,
    })

    return { entryId: entry.entry.id, created: entry.created }
  })

  // --- fraud review queue --------------------------------------------------

  app.get('/admin/review', viewer, async (request) => {
    const query = z
      .object({ state: z.enum(['open', 'resolved']).default('open') })
      .parse(request.query)

    const rows = await ctx.db
      .select({
        id: reviewItems.id,
        subjectType: reviewItems.subjectType,
        subjectId: reviewItems.subjectId,
        userId: reviewItems.userId,
        userEmail: users.email,
        reason: reviewItems.reason,
        priority: reviewItems.priority,
        state: reviewItems.state,
        createdAt: reviewItems.createdAt,
      })
      .from(reviewItems)
      .leftJoin(users, eq(users.id, reviewItems.userId))
      .where(eq(reviewItems.state, query.state))
      .orderBy(desc(reviewItems.priority), desc(reviewItems.createdAt))
      .limit(200)

    return { items: rows }
  })

  app.post('/admin/review/:id/resolve', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({ resolution: z.enum(['allow', 'deny']), notes: z.string().max(1000).optional() })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const [item] = await ctx.db.select().from(reviewItems).where(eq(reviewItems.id, id)).limit(1)
    if (!item || item.state !== 'open') return reply.code(404).send({ error: 'not open' })

    // Releasing a held completion means resolving its pending ledger entry.
    if (item.subjectType === 'completion') {
      const [entry] = await ctx.db
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(
          and(eq(ledgerEntries.completionId, item.subjectId), eq(ledgerEntries.status, 'pending')),
        )
        .limit(1)

      if (entry) {
        await ctx.ledger.resolvePending(entry.id, body.data.resolution === 'allow' ? 'posted' : 'rejected')
        await ctx.db
          .update(completions)
          .set({ status: body.data.resolution === 'allow' ? 'credited' : 'rejected' })
          .where(eq(completions.id, item.subjectId))
      }
    }

    if (item.subjectType === 'payout') {
      if (body.data.resolution === 'allow') {
        await ctx.payoutService.approve(item.subjectId, request.adminId!, body.data.notes)
        await ctx.payoutQueue.add(
          'settle',
          { payoutId: item.subjectId },
          { jobId: queueJobId('settle', item.subjectId), attempts: 3 },
        )
      } else {
        await ctx.payoutService.cancel(
          item.subjectId,
          { type: 'admin', id: request.adminId! },
          body.data.notes ?? 'denied in review',
        )
      }
    }

    await ctx.db
      .update(reviewItems)
      .set({
        state: 'resolved',
        resolution: body.data.resolution,
        resolvedByAdminId: request.adminId!,
        resolvedAt: sql`now()`,
        notes: body.data.notes ?? null,
      })
      .where(eq(reviewItems.id, id))

    await ctx.adminAuth.audit({
      adminId: request.adminId!,
      action: 'review.resolve',
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      after: { resolution: body.data.resolution },
      reason: body.data.notes,
      ip: request.ip,
    })

    return { ok: true }
  })

  // --- payout queue --------------------------------------------------------

  app.get('/admin/payouts', viewer, async (request) => {
    const query = z.object({ state: z.string().optional() }).parse(request.query)

    const rows = await ctx.db
      .select({
        id: payouts.id,
        userId: payouts.userId,
        userEmail: users.email,
        requestedPoints: payouts.requestedPoints,
        amountMinor: payouts.amountMinor,
        currency: payouts.currency,
        method: payouts.method,
        destinationMasked: payouts.destinationMasked,
        state: payouts.state,
        requestedAt: payouts.requestedAt,
        failureReason: payouts.failureReason,
      })
      .from(payouts)
      .innerJoin(users, eq(users.id, payouts.userId))
      .where(query.state ? eq(payouts.state, query.state as 'requested') : sql`true`)
      .orderBy(desc(payouts.requestedAt))
      .limit(200)

    return { payouts: rows }
  })

  app.post('/admin/payouts/:id/approve', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ reason: z.string().max(500).optional() }).safeParse(request.body ?? {})

    try {
      await ctx.payoutService.approve(id, request.adminId!, body.success ? body.data.reason : undefined)
      await ctx.payoutQueue.add(
        'settle',
        { payoutId: id },
        { jobId: queueJobId('settle', id), attempts: 3 },
      )
      await ctx.adminAuth.audit({
        adminId: request.adminId!,
        action: 'payout.approve',
        subjectType: 'payout',
        subjectId: id,
        ip: request.ip,
      })
      return { ok: true }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'failed' })
    }
  })

  app.post('/admin/payouts/:id/reject', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ reason: z.string().min(3).max(500) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'a reason is required' })

    try {
      await ctx.payoutService.cancel(id, { type: 'admin', id: request.adminId! }, body.data.reason)
      await ctx.adminAuth.audit({
        adminId: request.adminId!,
        action: 'payout.reject',
        subjectType: 'payout',
        subjectId: id,
        reason: body.data.reason,
        ip: request.ip,
      })
      return { ok: true }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'failed' })
    }
  })

  // --- networks ------------------------------------------------------------

  app.get('/admin/networks', viewer, async () => {
    const rows = await ctx.db.select().from(networks).orderBy(networks.name)
    // secret_ref names the env var; the secret itself is never in the database
    // and so can never leak through this endpoint.
    return { networks: rows, registeredAdapters: ctx.adapters.keys() }
  })

  app.post('/admin/networks/:id', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        enabled: z.boolean().optional(),
        revenueShareBps: z.number().int().min(0).max(10_000).optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const [before] = await ctx.db.select().from(networks).where(eq(networks.id, id)).limit(1)
    if (!before) return reply.code(404).send({ error: 'not found' })

    await ctx.db
      .update(networks)
      .set({
        ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
        ...(body.data.revenueShareBps !== undefined
          ? { revenueShareBps: body.data.revenueShareBps }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(networks.id, id))

    await ctx.adminAuth.audit({
      adminId: request.adminId!,
      action: 'network.update',
      subjectType: 'network',
      subjectId: id,
      before: { enabled: before.enabled, revenueShareBps: before.revenueShareBps },
      after: body.data,
      ip: request.ip,
    })

    return { ok: true }
  })

  // --- settings ------------------------------------------------------------

  app.get('/admin/settings', viewer, async () => {
    const rows = await ctx.db.select().from(settingsTable).orderBy(settingsTable.key)
    const { version } = await ctx.settingsService.get()
    return { settings: rows, configVersion: version }
  })

  app.put('/admin/settings/:key', superadmin, async (request, reply) => {
    const { key } = request.params as { key: string }
    const body = z.object({ value: z.unknown(), reason: z.string().max(500).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const version = await ctx.settingsService.set(
      key as keyof SettingsShape,
      body.data.value as never,
      request.adminId!,
      body.data.reason,
    )

    await ctx.adminAuth.audit({
      adminId: request.adminId!,
      action: 'settings.update',
      subjectType: 'setting',
      subjectId: key,
      after: { value: body.data.value, version },
      reason: body.data.reason,
      ip: request.ip,
    })

    return { ok: true, configVersion: version }
  })

  // --- reporting -----------------------------------------------------------

  /**
   * Per-network margin.
   *
   * Nobody builds this early and everybody needs it by month two. Without it
   * there is no way to answer the only question that matters about a supply
   * partner: after reversals, is this network making us money or costing us
   * money? A network with a 30% clawback rate can be gross-revenue positive
   * and still be a loss.
   */
  app.get('/admin/reporting/margin', viewer, async (request) => {
    const query = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(request.query)
    const { values: settings } = await ctx.settingsService.get()

    const rows = (await ctx.db.execute(sql`
      SELECT
        n.id, n.name, n.key, n.kind, n.revenue_share_bps,
        count(*) FILTER (WHERE c.kind = 'credit')::TEXT     AS credits,
        count(*) FILTER (WHERE c.kind = 'screenout')::TEXT  AS screenouts,
        count(*) FILTER (WHERE c.kind = 'reversal')::TEXT   AS reversals,
        COALESCE(SUM(c.gross_usd_micros) FILTER (WHERE c.kind IN ('credit','screenout')), 0)::TEXT AS gross_micros,
        COALESCE(SUM(c.gross_usd_micros) FILTER (WHERE c.kind = 'reversal'), 0)::TEXT AS reversed_micros,
        COALESCE(SUM(c.points_awarded) FILTER (WHERE c.kind IN ('credit','screenout')), 0)::TEXT AS points_awarded
      FROM networks n
      LEFT JOIN completions c
        ON c.network_id = n.id
       AND c.received_at > now() - make_interval(days => ${query.days})
      GROUP BY n.id, n.name, n.key, n.kind, n.revenue_share_bps
      ORDER BY gross_micros DESC
    `)) as unknown as Record<string, string>[]

    const report = rows.map((r) => {
      const gross = Number(r.gross_micros)
      const reversed = Number(r.reversed_micros)
      const pointsAwarded = Number(r.points_awarded)
      const paidToUsersMicros = Math.floor((pointsAwarded * 1_000_000) / settings.points_per_usd)
      const netRevenue = gross - reversed
      const credits = Number(r.credits)

      return {
        networkId: r.id,
        name: r.name,
        key: r.key,
        kind: r.kind,
        credits,
        screenouts: Number(r.screenouts),
        reversals: Number(r.reversals),
        grossUsdMicros: gross,
        reversedUsdMicros: reversed,
        netRevenueUsdMicros: netRevenue,
        paidToUsersUsdMicros: paidToUsersMicros,
        marginUsdMicros: netRevenue - paidToUsersMicros,
        // The number that decides whether a network is worth keeping.
        reversalRateBps: gross > 0 ? Math.round((reversed / gross) * 10_000) : 0,
      }
    })

    return { days: query.days, report }
  })

  // --- support queue -------------------------------------------------------

  app.get('/admin/tickets', viewer, async (request) => {
    const query = z.object({ status: z.string().optional() }).parse(request.query)
    const rows = await ctx.db
      .select({
        id: tickets.id,
        userId: tickets.userId,
        userEmail: users.email,
        kind: tickets.kind,
        subject: tickets.subject,
        status: tickets.status,
        externalTransactionId: tickets.externalTransactionId,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.userId))
      .where(query.status ? eq(tickets.status, query.status as 'open') : sql`true`)
      .orderBy(desc(tickets.createdAt))
      .limit(200)
    return { tickets: rows }
  })

  app.post('/admin/tickets/:id/reply', reviewer, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        message: z.string().min(1).max(4000),
        isInternal: z.boolean().default(false),
        status: z.enum(['open', 'awaiting_user', 'resolved', 'closed']).optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    await ctx.db.insert(ticketMessages).values({
      ticketId: id,
      authorAdminId: request.adminId!,
      body: body.data.message,
      isInternal: body.data.isInternal,
    })

    if (body.data.status) {
      await ctx.db
        .update(tickets)
        .set({
          status: body.data.status,
          updatedAt: sql`now()`,
          ...(body.data.status === 'resolved' ? { resolvedAt: sql`now()` } : {}),
        })
        .where(eq(tickets.id, id))
    }

    return { ok: true }
  })

  /**
   * Look up what a network actually sent for a disputed transaction.
   *
   * This is what turns a missing-points ticket from a guess into an answer:
   * either we have the raw postback and can say what happened to it, or we
   * never received one and the user needs to chase the network.
   */
  app.get('/admin/lookup/:transactionId', viewer, async (request) => {
    const { transactionId } = request.params as { transactionId: string }

    const events = (await ctx.db.execute(sql`
      SELECT id, network_key_raw, received_at, remote_ip, query_string,
             signature_valid, parse_status, parse_error, dedupe_outcome
      FROM postback_events
      WHERE query_string ILIKE ${'%' + transactionId + '%'}
      ORDER BY received_at DESC
      LIMIT 50
    `)) as unknown as Record<string, unknown>[]

    const matched = await ctx.db
      .select()
      .from(completions)
      .where(eq(completions.externalTransactionId, transactionId))
      .limit(20)

    const entries = await ctx.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.externalTransactionId, transactionId))
      .limit(20)

    return { postbackEvents: events, completions: matched, ledgerEntries: entries }
  })
}
