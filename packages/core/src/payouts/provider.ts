export type PayoutMethod = 'paypal' | 'upi' | 'giftcard' | 'crypto'

export type PayoutSendRequest = {
  /**
   * Passed straight through to the provider. Every real payout API accepts
   * one, and it is the only thing that stops a retry after a network timeout
   * from paying a user twice.
   */
  idempotencyKey: string
  amountMinor: number
  currency: string
  method: PayoutMethod
  destination: string
  metadata: Record<string, string>
}

/**
 * `processing` is a first-class result, not a failure.
 *
 * PayPal Payouts, every UPI aggregator and most gift-card APIs settle
 * asynchronously: they accept the request, return a reference, and tell you
 * the real outcome minutes or hours later via polling or a webhook. An
 * interface shaped as success-or-throw cannot express that, and would have to
 * be rewritten the day a real rail is connected.
 */
export type PayoutSendResult =
  | { status: 'processing'; providerReference: string; payload?: unknown }
  | { status: 'paid'; providerReference: string; payload?: unknown }
  | { status: 'failed'; providerReference?: string; failureReason: string; payload?: unknown }

export type PayoutStatus = {
  status: 'processing' | 'paid' | 'failed'
  failureReason?: string
  payload?: unknown
}

export type DestinationValidation = { valid: true } | { valid: false; reason: string }

export interface PayoutProvider {
  readonly key: string
  readonly methods: PayoutMethod[]

  /** Cheap, local sanity check before we reserve the user's points. */
  validateDestination(method: PayoutMethod, destination: string): Promise<DestinationValidation>

  send(request: PayoutSendRequest): Promise<PayoutSendResult>

  /** Polled for payouts left in `processing`. */
  getStatus(providerReference: string): Promise<PayoutStatus>
}
