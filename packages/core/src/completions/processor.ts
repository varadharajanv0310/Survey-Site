import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { completions, ledgerEntries, networks, offers, referrals, users } from '@app/db/schema'
import type { CanonicalCompletion } from '../adapters/types'
import type { SettingsShape } from '../config/settings'
import { FraudPipeline } from '../fraud/pipeline'
import { LedgerService } from '../ledger/service'
import { ledgerKeys } from '../ledger/keys'
import { awardPoints, currencyConfig } from '../money'
import { verifyUserToken } from '../auth/tokens'

export type ProcessOutcome = {
  status:
    | 'credited'
    | 'held_for_review'
    | 'rejected_fraud'
    | 'reversed'
    | 'duplicate'
    | 'unknown_user'
    | 'orphan_reversal'
  completionId?: string
  ledgerEntryId?: string
  pointsAwarded?: number
  reversedPoints?: number
  absorbedPoints?: number
  reason?: string
}

/**
 * Turns one canonical network event into ledger movement.
 *
 * This runs in the worker, never on the request thread. A postback must be
 * acknowledged in single-digit milliseconds — networks retry aggressively when
 * they do not get a fast 200, and each retry is another duplicate to
 * deduplicate.
 */
export class CompletionProcessor {
  constructor(
    private readonly db: Database,
    private readonly deps: {
      ledger: LedgerService
      fraud: FraudPipeline
      settings: SettingsShape
      configVersion: number
      userTokenSecret: string
      log: (message: string, meta?: Record<string, unknown>) => void
    },
  ) {}

  async process(input: {
    networkId: string
    networkKey: string
    completion: CanonicalCompletion
  }): Promise<ProcessOutcome> {
    const { completion, networkId, networkKey } = input

    /**
     * The signed token is verified before anything else touches money.
     *
     * Walls echo back whatever identifier we put in the URL. If that were a
     * bare user id, anyone could credit any account by editing `sub_id`. The
     * HMAC is what makes the identifier unforgeable, and this check is the
     * whole reason it exists.
     */
    const userId = verifyUserToken(completion.userToken, this.deps.userTokenSecret)
    if (!userId) {
      return { status: 'unknown_user', reason: 'user token signature did not verify' }
    }

    const [user] = await this.db
      .select({ id: users.id, status: users.status, country: users.country })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) return { status: 'unknown_user', reason: 'no such account' }

    const [network] = await this.db
      .select({ revenueShareBps: networks.revenueShareBps, kind: networks.kind })
      .from(networks)
      .where(eq(networks.id, networkId))
      .limit(1)
    if (!network) return { status: 'unknown_user', reason: 'unknown network' }

    if (completion.kind === 'reversal') {
      return this.applyReversal({ completion, networkId, networkKey, userId })
    }

    return this.applyCredit({
      completion,
      networkId,
      networkKey,
      userId,
      revenueShareBps: network.revenueShareBps,
      networkKind: network.kind,
      userBanned: user.status !== 'active',
    })
  }

  private async applyCredit(args: {
    completion: CanonicalCompletion
    networkId: string
    networkKey: string
    userId: string
    revenueShareBps: number
    networkKind: 'survey_wall' | 'offer_wall'
    userBanned: boolean
  }): Promise<ProcessOutcome> {
    const { completion, networkId, networkKey, userId } = args
    const settings = this.deps.settings

    const points = awardPoints({
      grossUsdMicros: completion.grossUsdMicros,
      revenueShareBps: args.revenueShareBps,
      currency: currencyConfig(settings),
      minAwardPoints: settings.min_award_points,
    })

    // Resolve the offer if we know it, so admin and support can see what the
    // user actually did. A missing offer is not fatal — offer walls send
    // completions for offers that have since left the catalog.
    let offerId: string | null = null
    if (completion.externalOfferId) {
      const [offer] = await this.db
        .select({ id: offers.id })
        .from(offers)
        .where(
          and(
            eq(offers.networkId, networkId),
            eq(offers.externalOfferId, completion.externalOfferId),
          ),
        )
        .limit(1)
      offerId = offer?.id ?? null
    }

    // Insert-or-nothing on the dedupe key. This is the boundary that makes a
    // retried postback harmless.
    const [row] = await this.db
      .insert(completions)
      .values({
        networkId,
        externalTransactionId: completion.externalTransactionId,
        kind: completion.kind,
        reversalEventId: '',
        userId,
        userTokenRaw: completion.userToken,
        offerId,
        externalOfferId: completion.externalOfferId ?? null,
        grossUsdMicros: completion.grossUsdMicros,
        pointsAwarded: points,
        configVersion: this.deps.configVersion,
        status: 'received',
        occurredAt: completion.occurredAt ?? null,
        ip: completion.ip ?? null,
        userAgent: completion.userAgent ?? null,
        raw: completion.raw as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: completions.id })

    if (!row) return { status: 'duplicate' }
    const completionId = row.id

    // A banned account's completions are recorded but never credited. We still
    // want the row: it is evidence, and the network still owes us the revenue.
    if (args.userBanned) {
      await this.db
        .update(completions)
        .set({ status: 'rejected', processedAt: sql`now()` })
        .where(eq(completions.id, completionId))
      return { status: 'rejected_fraud', completionId, reason: 'account is not active' }
    }

    const evaluation = await this.deps.fraud.evaluate(
      {
        type: 'completion',
        completionId,
        userId,
        networkId,
        grossUsdMicros: completion.grossUsdMicros,
        pointsAwarded: points,
        ip: completion.ip,
        userAgent: completion.userAgent,
      },
      {
        db: this.db,
        settings,
        configVersion: this.deps.configVersion,
        log: this.deps.log,
      },
    )

    if (evaluation.verdict === 'deny') {
      await this.db
        .update(completions)
        .set({ status: 'rejected', processedAt: sql`now()` })
        .where(eq(completions.id, completionId))
      return { status: 'rejected_fraud', completionId, reason: `fraud score ${evaluation.score}` }
    }

    /**
     * A flagged credit is HELD, not rejected.
     *
     * Most flagged users are real people on a shared IP or a recycled mobile
     * address. Silently eating their points is how a rewards site earns a
     * reputation for not paying, which is expensive in a category where users
     * compare notes constantly.
     */
    const held = evaluation.verdict === 'review'

    const holdHours =
      args.networkKind === 'survey_wall'
        ? settings.hold_window_hours_survey_wall
        : settings.hold_window_hours_offer_wall

    const entry = await this.deps.ledger.record({
      userId,
      amountPoints: points,
      type: completion.kind === 'screenout' ? 'screenout' : 'earn',
      idempotencyKey:
        completion.kind === 'screenout'
          ? ledgerKeys.screenout(networkKey, completion.externalTransactionId)
          : ledgerKeys.earn(networkKey, completion.externalTransactionId),
      status: held ? 'pending' : 'posted',
      holdHours,
      networkId,
      completionId,
      externalTransactionId: completion.externalTransactionId,
      configVersion: this.deps.configVersion,
    })

    await this.db
      .update(completions)
      .set({
        status: held ? 'pending_review' : 'credited',
        processedAt: sql`now()`,
      })
      .where(eq(completions.id, completionId))

    /**
     * A clawback for this transaction may already be sitting parked, because
     * the network's queue delivered it first. Apply it now rather than waiting
     * for the periodic sweep — until it runs, the user is holding points the
     * network has already taken back.
     */
    if (!held && entry.created) {
      await this.reconcileOrphanReversals({
        externalTransactionId: completion.externalTransactionId,
      })
    }

    // Referral effects only fire on a genuinely new, genuinely posted credit.
    if (!held && entry.created) {
      await this.applyReferralEffects(userId, entry.entry.id, points)
    }

    return {
      status: held ? 'held_for_review' : 'credited',
      completionId,
      ledgerEntryId: entry.entry.id,
      pointsAwarded: points,
    }
  }

  private async applyReversal(args: {
    completion: CanonicalCompletion
    networkId: string
    networkKey: string
    userId: string
  }): Promise<ProcessOutcome> {
    const { completion, networkId, networkKey, userId } = args
    const reversalEventId = completion.reversalEventId ?? 'derived'

    const [row] = await this.db
      .insert(completions)
      .values({
        networkId,
        externalTransactionId: completion.externalTransactionId,
        kind: 'reversal',
        reversalEventId,
        userId,
        userTokenRaw: completion.userToken,
        grossUsdMicros: completion.grossUsdMicros,
        configVersion: this.deps.configVersion,
        status: 'received',
        occurredAt: completion.occurredAt ?? null,
        raw: completion.raw as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: completions.id })

    if (!row) return { status: 'duplicate' }
    const completionId = row.id

    // Find the credit this reverses. Both the earn and screenout key shapes
    // are checked, because a wall can claw back either.
    const [original] = await this.db
      .select({ id: ledgerEntries.id, amountPoints: ledgerEntries.amountPoints })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          eq(ledgerEntries.externalTransactionId, completion.externalTransactionId),
          sql`${ledgerEntries.type} IN ('earn','screenout')`,
        ),
      )
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(1)

    /**
     * A reversal can legitimately arrive before the credit it reverses —
     * network queues are not ordered. Recording it and moving on is correct;
     * the completion row is kept so the mismatch is visible in admin rather
     * than lost. Reconciling these is a follow-up job, not a silent drop.
     */
    if (!original) {
      await this.db
        .update(completions)
        .set({ status: 'received', processedAt: sql`now()` })
        .where(eq(completions.id, completionId))
      this.deps.log('reversal arrived with no matching credit', {
        externalTransactionId: completion.externalTransactionId,
        networkKey,
      })
      return { status: 'orphan_reversal', completionId, reason: 'no matching credit found' }
    }

    const result = await this.deps.ledger.reverse({
      entryId: original.id,
      idempotencyKey: ledgerKeys.reversal(
        networkKey,
        completion.externalTransactionId,
        reversalEventId,
      ),
      externalTransactionId: completion.externalTransactionId,
      configVersion: this.deps.configVersion,
      reason: 'network clawback',
    })

    await this.db
      .update(completions)
      .set({ status: 'reversed', pointsAwarded: -result.reversedPoints, processedAt: sql`now()` })
      .where(eq(completions.id, completionId))

    // Mark the original credit's completion as reversed so support can see it.
    await this.db
      .update(completions)
      .set({ status: 'reversed' })
      .where(
        and(
          eq(completions.networkId, networkId),
          eq(completions.externalTransactionId, completion.externalTransactionId),
          eq(completions.kind, 'credit'),
        ),
      )

    return {
      status: 'reversed',
      completionId,
      reversedPoints: result.reversedPoints,
      absorbedPoints: result.absorbedPoints,
    }
  }

  /**
   * Apply reversals that arrived before the credit they reverse.
   *
   * Network queues are not ordered, so a clawback can genuinely land first.
   * When it does, `applyReversal` parks the completion as `received` because
   * there is nothing yet to offset. Without this sweep it stays parked
   * forever, the credit arrives moments later, and the user permanently keeps
   * points the network already took back.
   *
   * Run periodically by the worker. Idempotent — the reversal's ledger key is
   * unchanged, so a completion already applied is a no-op.
   */
  async reconcileOrphanReversals(
    opts: { limit?: number; externalTransactionId?: string } = {},
  ): Promise<{ examined: number; applied: number }> {
    const orphans = await this.db
      .select({
        id: completions.id,
        networkId: completions.networkId,
        externalTransactionId: completions.externalTransactionId,
        reversalEventId: completions.reversalEventId,
        userId: completions.userId,
        networkKey: networks.key,
      })
      .from(completions)
      .innerJoin(networks, eq(networks.id, completions.networkId))
      .where(
        and(
          eq(completions.kind, 'reversal'),
          eq(completions.status, 'received'),
          opts.externalTransactionId
            ? eq(completions.externalTransactionId, opts.externalTransactionId)
            : sql`true`,
        ),
      )
      .limit(opts.limit ?? 100)

    let applied = 0

    for (const orphan of orphans) {
      if (!orphan.userId) continue

      const [original] = await this.db
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.userId, orphan.userId),
            eq(ledgerEntries.externalTransactionId, orphan.externalTransactionId),
            sql`${ledgerEntries.type} IN ('earn','screenout')`,
          ),
        )
        .orderBy(desc(ledgerEntries.createdAt))
        .limit(1)

      // Still nothing to reverse. Leave it parked and try again next sweep.
      if (!original) continue

      const result = await this.deps.ledger.reverse({
        entryId: original.id,
        idempotencyKey: ledgerKeys.reversal(
          orphan.networkKey,
          orphan.externalTransactionId,
          orphan.reversalEventId || 'derived',
        ),
        externalTransactionId: orphan.externalTransactionId,
        configVersion: this.deps.configVersion,
        reason: 'network clawback (reconciled out-of-order)',
      })

      await this.db
        .update(completions)
        .set({
          status: 'reversed',
          pointsAwarded: -result.reversedPoints,
          processedAt: sql`now()`,
        })
        .where(eq(completions.id, orphan.id))

      await this.db
        .update(completions)
        .set({ status: 'reversed' })
        .where(
          and(
            eq(completions.networkId, orphan.networkId),
            eq(completions.externalTransactionId, orphan.externalTransactionId),
            eq(completions.kind, 'credit'),
          ),
        )

      this.deps.log('reconciled out-of-order reversal', {
        externalTransactionId: orphan.externalTransactionId,
        reversedPoints: result.reversedPoints,
        absorbedPoints: result.absorbedPoints,
      })
      applied += 1
    }

    return { examined: orphans.length, applied }
  }

  /**
   * Referral bonus and commission.
   *
   * The one-off bonus fires on the referee's FIRST earning, not at signup.
   * Paying at signup is free money for anyone with a disposable email address,
   * and it is the single most exploited mechanic in this category.
   */
  private async applyReferralEffects(
    refereeId: string,
    sourceEntryId: string,
    pointsEarned: number,
  ): Promise<void> {
    const settings = this.deps.settings

    const [referral] = await this.db
      .select()
      .from(referrals)
      .where(eq(referrals.refereeUserId, refereeId))
      .limit(1)

    if (!referral) return

    if (!referral.qualifiedAt) {
      const bonus = await this.deps.ledger.record({
        userId: referral.referrerUserId,
        amountPoints: settings.referral_bonus_points,
        type: 'referral_bonus',
        idempotencyKey: ledgerKeys.referralBonus(referral.referrerUserId, refereeId),
        referralId: referral.id,
        note: 'referral qualified',
      })

      await this.db
        .update(referrals)
        .set({ qualifiedAt: sql`now()`, bonusEntryId: bonus.entry.id })
        .where(eq(referrals.id, referral.id))
    }

    const commission = Math.floor((pointsEarned * settings.referral_commission_bps) / 10_000)
    if (commission > 0) {
      await this.deps.ledger.record({
        userId: referral.referrerUserId,
        amountPoints: commission,
        type: 'referral_commission',
        // Keyed on the source entry, so a replay pays commission once.
        idempotencyKey: ledgerKeys.referralCommission(referral.referrerUserId, sourceEntryId),
        referralId: referral.id,
        note: `commission on referee earning`,
      })

      await this.db
        .update(referrals)
        .set({ lifetimeCommissionPoints: sql`${referrals.lifetimeCommissionPoints} + ${commission}` })
        .where(eq(referrals.id, referral.id))
    }
  }
}
