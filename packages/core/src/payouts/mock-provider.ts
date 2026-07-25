import { createHash } from 'node:crypto'
import type {
  DestinationValidation,
  PayoutMethod,
  PayoutProvider,
  PayoutSendRequest,
  PayoutSendResult,
  PayoutStatus,
} from './provider'

/**
 * The only payout provider that exists today. There are no real payout rails,
 * and this does not pretend otherwise — no money moves.
 *
 * It is deliberately not a always-succeeds stub. Real rails fail in specific,
 * recurring ways, and code that has only ever seen success handles none of
 * them:
 *
 *   - most sends settle asynchronously, so `processing` is the common result
 *   - some destinations are structurally invalid and fail immediately
 *   - a small share fail after acceptance (closed account, blocked recipient)
 *   - the same idempotency key must return the same reference, forever
 *
 * Outcomes are derived from a hash of the idempotency key rather than randomly,
 * so a given payout behaves identically on every run and on every retry.
 */
export class MockPayoutProvider implements PayoutProvider {
  readonly key = 'mock'
  readonly methods: PayoutMethod[] = ['paypal', 'upi', 'giftcard']

  private readonly sent = new Map<string, PayoutSendResult>()
  private readonly settleAfter = new Map<string, number>()

  async validateDestination(
    method: PayoutMethod,
    destination: string,
  ): Promise<DestinationValidation> {
    const value = destination.trim()
    if (!value) return { valid: false, reason: 'destination is empty' }

    switch (method) {
      case 'paypal':
        return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
          ? { valid: true }
          : { valid: false, reason: 'not a valid email address' }
      case 'upi':
        return /^[\w.\-]{2,64}@[a-zA-Z]{2,32}$/.test(value)
          ? { valid: true }
          : { valid: false, reason: 'not a valid UPI id' }
      case 'giftcard':
        return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
          ? { valid: true }
          : { valid: false, reason: 'gift cards are delivered by email' }
      default:
        return { valid: false, reason: `unsupported method: ${method}` }
    }
  }

  async send(request: PayoutSendRequest): Promise<PayoutSendResult> {
    // Idempotency is the whole point of the key. A retried send returns the
    // original result rather than creating a second disbursement.
    const existing = this.sent.get(request.idempotencyKey)
    if (existing) return existing

    const bucket = hashBucket(request.idempotencyKey)
    const providerReference = `mock_${createHash('sha256')
      .update(request.idempotencyKey)
      .digest('hex')
      .slice(0, 16)}`

    let result: PayoutSendResult
    if (bucket < 5) {
      result = {
        status: 'failed',
        providerReference,
        failureReason: 'recipient account is closed',
        payload: { simulated: true, bucket },
      }
    } else if (bucket < 25) {
      // Settles immediately. Gift-card APIs often do.
      result = { status: 'paid', providerReference, payload: { simulated: true, bucket } }
    } else {
      // The common case: accepted now, resolved later.
      result = { status: 'processing', providerReference, payload: { simulated: true, bucket } }
      this.settleAfter.set(providerReference, Date.now() + 5_000)
    }

    this.sent.set(request.idempotencyKey, result)
    return result
  }

  async getStatus(providerReference: string): Promise<PayoutStatus> {
    const due = this.settleAfter.get(providerReference)
    if (due === undefined) return { status: 'paid' }
    if (Date.now() < due) return { status: 'processing' }

    // A minority of accepted payouts still fail on settlement.
    const bucket = hashBucket(providerReference)
    if (bucket < 8) {
      return { status: 'failed', failureReason: 'rejected by receiving bank' }
    }
    return { status: 'paid' }
  }
}

function hashBucket(value: string): number {
  const digest = createHash('sha256').update(value).digest()
  return digest[0]! % 100
}
