import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import {
  dailyClaims,
  ledgerEntries,
  networks,
  offers,
  payouts,
  referrals,
  ticketMessages,
  tickets,
  users,
  wallPlacements,
} from '@app/db/schema'
import { PayoutError, ledgerKeys, minorUnitsForPoints, queueJobId, signUserToken } from '@app/core'
import type { AppContext } from '../context'
import { requireUser } from '../auth-hook'

export async function registerUserRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = { preHandler: requireUser(ctx) }

  // --- balance and history -------------------------------------------------

  app.get('/me/balance', auth, async (request) => {
    const balance = await ctx.ledger.getBalance(request.userId!)
    const { values: settings } = await ctx.settingsService.get()
    return {
      ...balance,
      // Shown alongside the points so the number means something to the user.
      estimatedValueMinor: minorUnitsForPoints(balance.posted, settings.points_per_usd),
      currency: 'USD',
      minRedemptionPoints: settings.min_redemption_points,
    }
  })

  app.get('/me/history', auth, async (request) => {
    const query = z
      .object({ limit: z.coerce.number().min(1).max(100).default(50), offset: z.coerce.number().min(0).default(0) })
      .parse(request.query)

    const rows = await ctx.db
      .select({
        id: ledgerEntries.id,
        amountPoints: ledgerEntries.amountPoints,
        type: ledgerEntries.type,
        status: ledgerEntries.status,
        availableAt: ledgerEntries.availableAt,
        note: ledgerEntries.note,
        createdAt: ledgerEntries.createdAt,
        networkName: networks.name,
      })
      .from(ledgerEntries)
      .leftJoin(networks, eq(networks.id, ledgerEntries.networkId))
      .where(eq(ledgerEntries.userId, request.userId!))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(query.limit)
      .offset(query.offset)

    return { entries: rows }
  })

  // --- the feed ------------------------------------------------------------

  /**
   * Offers and survey walls in one response, because they are one surface to
   * the user even though they are different things underneath.
   *
   * Targeting is applied here rather than in the client. Showing a US-only
   * offer to a user in India produces a support ticket when it does not
   * convert, and enough of those produce a complaint from the network.
   */
  app.get('/offers', auth, async (request) => {
    const query = z
      .object({
        category: z.string().optional(),
        device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
      })
      .parse(request.query)

    const [user] = await ctx.db
      .select({ country: users.country })
      .from(users)
      .where(eq(users.id, request.userId!))
      .limit(1)

    const country = user?.country ?? 'US'
    const userToken = signUserToken(request.userId!, ctx.userTokenSecret)

    const offerRows = await ctx.db
      .select({
        id: offers.id,
        title: offers.title,
        description: offers.description,
        requirements: offers.requirements,
        category: offers.category,
        points: offers.points,
        iconUrl: offers.iconUrl,
        estimatedMinutes: offers.estimatedMinutes,
        urlTemplate: offers.urlTemplate,
        networkName: networks.name,
      })
      .from(offers)
      .innerJoin(networks, eq(networks.id, offers.networkId))
      .where(
        and(
          eq(offers.isActive, true),
          eq(networks.enabled, true),
          // No country list means "everywhere".
          or(isNull(offers.countries), sql`${country} = ANY(${offers.countries})`),
          or(
            isNull(offers.excludedCountries),
            sql`NOT (${country} = ANY(${offers.excludedCountries}))`,
          ),
          query.device ? sql`${query.device} = ANY(${offers.devices})` : sql`true`,
          query.category ? eq(offers.category, query.category as 'survey') : sql`true`,
        ),
      )
      .orderBy(desc(offers.points))
      .limit(100)

    const placementRows = await ctx.db
      .select({
        id: wallPlacements.id,
        name: wallPlacements.name,
        networkId: wallPlacements.networkId,
        networkKey: networks.key,
        networkName: networks.name,
        urlTemplate: wallPlacements.urlTemplate,
        config: networks.config,
        secretRef: networks.secretRef,
        sortOrder: wallPlacements.sortOrder,
      })
      .from(wallPlacements)
      .innerJoin(networks, eq(networks.id, wallPlacements.networkId))
      .where(
        and(
          eq(wallPlacements.enabled, true),
          eq(networks.enabled, true),
          or(isNull(wallPlacements.countries), sql`${country} = ANY(${wallPlacements.countries})`),
        ),
      )
      .orderBy(wallPlacements.sortOrder)

    const walls = placementRows.map((row) => {
      const adapter = ctx.adapters.get(row.networkKey)
      const adapterCtx = ctx.adapters.contextFor(
        { key: row.networkKey, config: row.config, secretRef: row.secretRef },
        ctx.log,
      )
      const url = adapter?.buildPlacementUrl
        ? adapter.buildPlacementUrl(adapterCtx, { userToken, country })
        : row.urlTemplate.replace('{user_token}', encodeURIComponent(userToken))

      return { id: row.id, name: row.name, networkName: row.networkName, url }
    })

    return {
      offers: offerRows.map((o) => ({
        ...o,
        url: o.urlTemplate.replace('{user_token}', encodeURIComponent(userToken)),
        urlTemplate: undefined,
      })),
      walls,
      country,
    }
  })

  // --- referrals -----------------------------------------------------------

  app.get('/me/referrals', auth, async (request) => {
    const [user] = await ctx.db
      .select({ referralCode: users.referralCode })
      .from(users)
      .where(eq(users.id, request.userId!))
      .limit(1)

    const rows = await ctx.db
      .select({
        id: referrals.id,
        refereeEmail: users.email,
        attributedAt: referrals.attributedAt,
        qualifiedAt: referrals.qualifiedAt,
        lifetimeCommissionPoints: referrals.lifetimeCommissionPoints,
      })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.refereeUserId))
      .where(eq(referrals.referrerUserId, request.userId!))
      .orderBy(desc(referrals.attributedAt))
      .limit(100)

    const { values: settings } = await ctx.settingsService.get()

    return {
      referralCode: user?.referralCode,
      bonusPoints: settings.referral_bonus_points,
      commissionBps: settings.referral_commission_bps,
      referrals: rows.map((r) => ({
        ...r,
        // Partial address only. A referrer does not need their referee's
        // full email, and showing it invites harassment and scraping.
        refereeEmail: r.refereeEmail.replace(/^(.).*(@.*)$/, '$1•••$2'),
      })),
    }
  })

  // --- daily bonus ---------------------------------------------------------

  /**
   * Streaks and daily bonuses are not decoration in this category. They are
   * most of the reason a user opens the site on day 30 rather than day 1.
   */
  app.post('/me/daily-bonus', auth, async (request, reply) => {
    const { values: settings } = await ctx.settingsService.get()
    const userId = request.userId!

    const [todayRow] = (await ctx.db.execute(
      sql`SELECT (now() AT TIME ZONE 'UTC')::date::TEXT AS today`,
    )) as unknown as { today: string }[]
    const today = todayRow!.today

    const [existing] = await ctx.db
      .select({ id: dailyClaims.id })
      .from(dailyClaims)
      .where(and(eq(dailyClaims.userId, userId), eq(dailyClaims.claimDate, today)))
      .limit(1)

    if (existing) return reply.code(409).send({ error: 'already claimed today' })

    const [previous] = await ctx.db
      .select({ streakDay: dailyClaims.streakDay, claimDate: dailyClaims.claimDate })
      .from(dailyClaims)
      .where(eq(dailyClaims.userId, userId))
      .orderBy(desc(dailyClaims.claimDate))
      .limit(1)

    const [yesterdayRow] = (await ctx.db.execute(
      sql`SELECT ((now() AT TIME ZONE 'UTC')::date - 1)::TEXT AS yesterday`,
    )) as unknown as { yesterday: string }[]

    const continuing = previous?.claimDate === yesterdayRow!.yesterday
    const streakDay = continuing
      ? Math.min(previous!.streakDay + 1, settings.daily_bonus_max_streak_days)
      : 1

    const points =
      settings.daily_bonus_base_points + (streakDay - 1) * settings.daily_bonus_streak_bonus_points

    const entry = await ctx.ledger.record({
      userId,
      amountPoints: points,
      type: 'bonus',
      idempotencyKey: ledgerKeys.dailyBonus(userId, today),
      note: `daily bonus, streak day ${streakDay}`,
    })

    await ctx.db
      .insert(dailyClaims)
      .values({ userId, claimDate: today, streakDay, pointsAwarded: points, entryId: entry.entry.id })
      .onConflictDoNothing()

    return { points, streakDay, claimed: entry.created }
  })

  app.get('/me/daily-bonus', auth, async (request) => {
    const rows = await ctx.db
      .select()
      .from(dailyClaims)
      .where(eq(dailyClaims.userId, request.userId!))
      .orderBy(desc(dailyClaims.claimDate))
      .limit(30)

    const [todayRow] = (await ctx.db.execute(
      sql`SELECT (now() AT TIME ZONE 'UTC')::date::TEXT AS today`,
    )) as unknown as { today: string }[]

    return {
      claims: rows,
      claimedToday: rows.some((r) => r.claimDate === todayRow!.today),
      currentStreak: rows[0]?.streakDay ?? 0,
    }
  })

  // --- redemption ----------------------------------------------------------

  app.post('/me/payouts', auth, async (request, reply) => {
    const body = z
      .object({
        points: z.number().int().positive(),
        method: z.enum(['paypal', 'upi', 'giftcard']),
        destination: z.string().min(3).max(200),
      })
      .safeParse(request.body)

    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    try {
      const result = await ctx.payoutService.request({
        userId: request.userId!,
        points: body.data.points,
        method: body.data.method,
        destination: body.data.destination,
        ip: request.ip,
      })

      // Approved payouts are handed to the worker, never settled inline. A
      // payment API can take seconds and a user request must not be holding a
      // connection open while it thinks.
      if (result.state === 'requested') {
        await ctx.payoutQueue.add(
          'settle',
          { payoutId: result.payoutId },
          { jobId: queueJobId('settle', result.payoutId), attempts: 3 },
        )
      }

      return result
    } catch (error) {
      if (error instanceof PayoutError) return reply.code(400).send({ error: error.message, code: error.code })
      if (error instanceof Error && error.name === 'InsufficientBalanceError') {
        return reply.code(400).send({ error: error.message, code: 'insufficient_balance' })
      }
      throw error
    }
  })

  app.get('/me/payouts', auth, async (request) => {
    const rows = await ctx.db
      .select({
        id: payouts.id,
        requestedPoints: payouts.requestedPoints,
        amountMinor: payouts.amountMinor,
        currency: payouts.currency,
        method: payouts.method,
        destinationMasked: payouts.destinationMasked,
        state: payouts.state,
        requestedAt: payouts.requestedAt,
        settledAt: payouts.settledAt,
        failureReason: payouts.failureReason,
      })
      .from(payouts)
      .where(eq(payouts.userId, request.userId!))
      .orderBy(desc(payouts.requestedAt))
      .limit(50)

    return { payouts: rows }
  })

  app.post('/me/payouts/:id/cancel', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [payout] = await ctx.db
      .select({ userId: payouts.userId, state: payouts.state })
      .from(payouts)
      .where(eq(payouts.id, id))
      .limit(1)

    if (!payout || payout.userId !== request.userId!) {
      return reply.code(404).send({ error: 'not found' })
    }

    try {
      await ctx.payoutService.cancel(id, { type: 'user', id: request.userId! }, 'cancelled by user')
      return { ok: true }
    } catch (error) {
      if (error instanceof PayoutError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })

  // --- support tickets -----------------------------------------------------

  /**
   * "I completed the offer and never got my points" is the highest-volume
   * message a site in this category receives. Capturing it as structured data
   * rather than free text means most claims can be resolved by looking the
   * transaction up in `postback_events` and telling the user exactly what the
   * network did or did not send.
   */
  app.post('/me/tickets', auth, async (request, reply) => {
    const body = z
      .object({
        kind: z.enum(['missing_points', 'payout_issue', 'account', 'other']),
        subject: z.string().min(3).max(200),
        message: z.string().min(3).max(4000),
        networkId: z.string().uuid().optional(),
        externalTransactionId: z.string().max(200).optional(),
        claimedOfferName: z.string().max(200).optional(),
      })
      .safeParse(request.body)

    if (!body.success) return reply.code(400).send({ error: 'invalid input' })

    const [ticket] = await ctx.db
      .insert(tickets)
      .values({
        userId: request.userId!,
        kind: body.data.kind,
        subject: body.data.subject,
        networkId: body.data.networkId ?? null,
        externalTransactionId: body.data.externalTransactionId ?? null,
        claimedOfferName: body.data.claimedOfferName ?? null,
      })
      .returning({ id: tickets.id })

    await ctx.db.insert(ticketMessages).values({
      ticketId: ticket!.id,
      authorUserId: request.userId!,
      body: body.data.message,
    })

    return { ticketId: ticket!.id }
  })

  app.get('/me/tickets', auth, async (request) => {
    const rows = await ctx.db
      .select()
      .from(tickets)
      .where(eq(tickets.userId, request.userId!))
      .orderBy(desc(tickets.createdAt))
      .limit(50)
    return { tickets: rows }
  })

  app.get('/me/tickets/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [ticket] = await ctx.db.select().from(tickets).where(eq(tickets.id, id)).limit(1)
    if (!ticket || ticket.userId !== request.userId!) {
      return reply.code(404).send({ error: 'not found' })
    }

    const messages = await ctx.db
      .select()
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, id), eq(ticketMessages.isInternal, false)))
      .orderBy(ticketMessages.createdAt)

    return { ticket, messages }
  })
}
