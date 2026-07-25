import { eq, sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { payouts, payoutTransitions, users } from '@app/db/schema'
import type { SettingsShape } from '../config/settings'
import { hashDestination, maskDestination } from '../auth/tokens'
import { LedgerService } from '../ledger/service'
import { ledgerKeys } from '../ledger/keys'
import { minorUnitsForPoints } from '../money'
import type { FraudPipeline } from '../fraud/pipeline'
import type { FraudContext } from '../fraud/types'
import type { PayoutMethod, PayoutProvider } from './provider'

export type PayoutState =
  | 'requested'
  | 'under_review'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'

/**
 * The only legal moves. Anything not listed is rejected, which means a bug in
 * a caller surfaces as a loud error rather than a payout quietly skipping the
 * approval step.
 */
export const PAYOUT_TRANSITIONS: Record<PayoutState, PayoutState[]> = {
  requested: ['under_review', 'approved', 'cancelled'],
  under_review: ['approved', 'cancelled'],
  approved: ['processing', 'cancelled'],
  processing: ['paid', 'failed'],
  // A failed payout can be retried after the user fixes their details, or
  // abandoned. It is not terminal.
  failed: ['processing', 'cancelled'],
  paid: [],
  cancelled: [],
}

/** States in which the user's reserved points have been returned to them. */
const REFUNDED_STATES: PayoutState[] = ['cancelled']

export class PayoutError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'below_minimum'
      | 'insufficient_balance'
      | 'invalid_destination'
      | 'illegal_transition'
      | 'not_found'
      | 'email_unverified',
  ) {
    super(message)
    this.name = 'PayoutError'
  }
}

export class PayoutService {
  constructor(
    private readonly db: Database,
    private readonly deps: {
      ledger: LedgerService
      provider: PayoutProvider
      fraud: FraudPipeline
      settings: SettingsShape
      configVersion: number
      destinationSecret: string
      log: (message: string, meta?: Record<string, unknown>) => void
    },
  ) {}

  /**
   * Create a payout and DEBIT THE LEDGER IMMEDIATELY.
   *
   * The debit happens here, at request time, not when the money actually
   * moves. Without that, a user with 1000 withdrawable points can submit three
   * 1000-point requests before an admin looks at the first one, and all three
   * are payable.
   *
   * The debit is reversed with a new positive entry if the payout is later
   * cancelled — never by deleting the original.
   */
  async request(input: {
    userId: string
    points: number
    method: PayoutMethod
    destination: string
    ip?: string | undefined
  }): Promise<{ payoutId: string; state: PayoutState }> {
    const settings = this.deps.settings

    if (input.points < settings.min_redemption_points) {
      throw new PayoutError(
        `minimum redemption is ${settings.min_redemption_points} points`,
        'below_minimum',
      )
    }

    const [user] = await this.db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
    if (!user) throw new PayoutError('user not found', 'not_found')
    if (!user.emailVerifiedAt) {
      throw new PayoutError('confirm your email address before cashing out', 'email_unverified')
    }

    const validation = await this.deps.provider.validateDestination(input.method, input.destination)
    if (!validation.valid) throw new PayoutError(validation.reason, 'invalid_destination')

    const payoutId = crypto.randomUUID()
    const amountMinor = minorUnitsForPoints(input.points, settings.points_per_usd)

    // Reserve first. If the balance is short this throws and no payout row is
    // created, so there is never a payout without a matching debit.
    const reserve = await this.deps.ledger.reserveForPayout({
      userId: input.userId,
      points: input.points,
      payoutId,
      idempotencyKey: ledgerKeys.redeem(payoutId),
    })

    await this.db.insert(payouts).values({
      id: payoutId,
      userId: input.userId,
      requestedPoints: input.points,
      amountMinor,
      currency: 'USD',
      configVersion: this.deps.configVersion,
      method: input.method,
      destinationMasked: maskDestination(input.destination),
      destinationHash: hashDestination(input.destination, this.deps.destinationSecret),
      state: 'requested',
      providerKey: this.deps.provider.key,
      reserveEntryId: reserve.entry.id,
      idempotencyKey: `payout:${payoutId}`,
      requestedIp: input.ip ?? null,
    })

    await this.recordTransition(payoutId, null, 'requested', 'user', input.userId, 'payout requested')

    // Fraud runs after the reserve, so a denied payout still leaves the points
    // debited and awaiting an admin decision rather than instantly refunded.
    const ctx: FraudContext = {
      db: this.db,
      settings,
      configVersion: this.deps.configVersion,
      log: this.deps.log,
    }
    const evaluation = await this.deps.fraud.evaluate(
      {
        type: 'payout',
        payoutId,
        userId: input.userId,
        points: input.points,
        destinationHash: hashDestination(input.destination, this.deps.destinationSecret),
        ip: input.ip,
      },
      ctx,
    )

    if (evaluation.verdict !== 'allow') {
      await this.transition(payoutId, 'under_review', 'system', null, `fraud: ${evaluation.verdict}`)
      return { payoutId, state: 'under_review' }
    }

    if (settings.review_first_payout || input.points >= settings.review_payout_above_points) {
      await this.transition(payoutId, 'under_review', 'system', null, 'policy: manual review')
      return { payoutId, state: 'under_review' }
    }

    return { payoutId, state: 'requested' }
  }

  async approve(payoutId: string, adminId: string, reason?: string): Promise<void> {
    await this.transition(payoutId, 'approved', 'admin', adminId, reason ?? 'approved by admin')
    await this.db
      .update(payouts)
      .set({ decidedAt: sql`now()`, decidedByAdminId: adminId })
      .where(eq(payouts.id, payoutId))
  }

  /** Cancel and return the reserved points to the user as a new entry. */
  async cancel(
    payoutId: string,
    actor: { type: 'admin' | 'user' | 'system'; id: string | null },
    reason: string,
  ): Promise<void> {
    const payout = await this.load(payoutId)
    await this.transition(payoutId, 'cancelled', actor.type, actor.id, reason)

    await this.deps.ledger.refundPayout({
      userId: payout.userId,
      points: payout.requestedPoints,
      payoutId,
      idempotencyKey: ledgerKeys.redeemRefund(payoutId),
      reason: `payout cancelled: ${reason}`,
    })

    const [refund] = await this.db
      .select({ id: sql<string>`id` })
      .from(sql`ledger_entries`)
      .where(sql`idempotency_key = ${ledgerKeys.redeemRefund(payoutId)}`)
      .limit(1)

    if (refund) {
      await this.db.update(payouts).set({ refundEntryId: refund.id }).where(eq(payouts.id, payoutId))
    }
  }

  /**
   * Hand an approved payout to the provider.
   *
   * Called by the worker, never inline in a request. The provider may take
   * seconds, and a user-facing request must not be holding a connection open
   * while a payment API thinks about it.
   */
  async settle(payoutId: string): Promise<PayoutState> {
    const payout = await this.load(payoutId)

    if (payout.state !== 'approved' && payout.state !== 'failed') {
      throw new PayoutError(
        `payout ${payoutId} is ${payout.state}, not approved`,
        'illegal_transition',
      )
    }

    await this.transition(payoutId, 'processing', 'system', null, 'sent to provider')

    const result = await this.deps.provider.send({
      idempotencyKey: payout.idempotencyKey,
      amountMinor: payout.amountMinor,
      currency: payout.currency,
      method: payout.method as PayoutMethod,
      // The real destination is not stored in plaintext, so a live provider
      // will read it from a secrets store keyed by payout id. The mock only
      // needs something stable and correctly shaped.
      destination: payout.destinationMasked,
      metadata: { payout_id: payoutId, user_id: payout.userId },
    })

    await this.db
      .update(payouts)
      .set({
        providerReference: result.providerReference ?? null,
        providerPayload: (result.payload ?? null) as Record<string, unknown> | null,
      })
      .where(eq(payouts.id, payoutId))

    if (result.status === 'paid') {
      await this.transition(payoutId, 'paid', 'provider', null, 'settled immediately')
      await this.db.update(payouts).set({ settledAt: sql`now()` }).where(eq(payouts.id, payoutId))
      return 'paid'
    }

    if (result.status === 'failed') {
      await this.transition(payoutId, 'failed', 'provider', null, result.failureReason)
      await this.db
        .update(payouts)
        .set({ failureReason: result.failureReason })
        .where(eq(payouts.id, payoutId))
      return 'failed'
    }

    return 'processing'
  }

  /** Poll a payout the provider accepted but has not yet resolved. */
  async pollStatus(payoutId: string): Promise<PayoutState> {
    const payout = await this.load(payoutId)
    if (payout.state !== 'processing' || !payout.providerReference) return payout.state as PayoutState

    const status = await this.deps.provider.getStatus(payout.providerReference)

    if (status.status === 'paid') {
      await this.transition(payoutId, 'paid', 'provider', null, 'settled')
      await this.db.update(payouts).set({ settledAt: sql`now()` }).where(eq(payouts.id, payoutId))
      return 'paid'
    }

    if (status.status === 'failed') {
      await this.transition(payoutId, 'failed', 'provider', null, status.failureReason ?? 'failed')
      await this.db
        .update(payouts)
        .set({ failureReason: status.failureReason ?? 'failed' })
        .where(eq(payouts.id, payoutId))
      return 'failed'
    }

    return 'processing'
  }

  private async transition(
    payoutId: string,
    to: PayoutState,
    actorType: 'user' | 'admin' | 'system' | 'provider',
    actorId: string | null,
    reason?: string,
  ): Promise<void> {
    const payout = await this.load(payoutId)
    const from = payout.state as PayoutState

    if (!PAYOUT_TRANSITIONS[from].includes(to)) {
      throw new PayoutError(
        `illegal payout transition ${from} -> ${to} for ${payoutId}`,
        'illegal_transition',
      )
    }

    await this.db.update(payouts).set({ state: to }).where(eq(payouts.id, payoutId))
    await this.recordTransition(payoutId, from, to, actorType, actorId, reason)
  }

  private async recordTransition(
    payoutId: string,
    from: PayoutState | null,
    to: PayoutState,
    actorType: 'user' | 'admin' | 'system' | 'provider',
    actorId: string | null,
    reason?: string,
  ): Promise<void> {
    await this.db.insert(payoutTransitions).values({
      payoutId,
      fromState: from,
      toState: to,
      actorType,
      actorId: actorId && isUuid(actorId) ? actorId : null,
      reason: reason ?? null,
    })
  }

  private async load(payoutId: string) {
    const [payout] = await this.db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1)
    if (!payout) throw new PayoutError(`payout ${payoutId} not found`, 'not_found')
    return payout
  }
}

export function isRefunded(state: PayoutState): boolean {
  return REFUNDED_STATES.includes(state)
}

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
