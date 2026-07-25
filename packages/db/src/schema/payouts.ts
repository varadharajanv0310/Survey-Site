import { bigint, index, inet, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, ts } from './_shared'
import { actorTypeEnum, payoutMethodEnum, payoutStateEnum } from './enums'
import { adminUsers, users } from './identity'
import { ledgerEntries } from './ledger'

/**
 * A payout is a state machine with an audit trail, not a function call.
 *
 * Two things here are load-bearing:
 *
 * 1. The ledger is debited at REQUEST time (`reserveEntryId`), not at paid
 *    time. Otherwise a user with 1000 points requests three 1000-point
 *    payouts before an admin looks at the first one. A cancelled or failed
 *    payout is refunded with a new positive entry (`refundEntryId`), never by
 *    deleting the debit.
 *
 * 2. `send()` on a provider may legitimately return 'processing'. PayPal
 *    Payouts and every UPI aggregator settle asynchronously, so 'paid' is
 *    frequently learned later via `getStatus` or a provider webhook. A design
 *    that assumed success-or-throw would need rewriting on the first real rail.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    requestedPoints: bigint('requested_points', { mode: 'number' }).notNull(),
    /** Minor units of `currency` (cents, paise). Integer, never float. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    configVersion: bigint('config_version', { mode: 'number' }).notNull().default(0),

    method: payoutMethodEnum('method').notNull(),
    /** What we show back to the user: 'j••••@gmail.com'. Never the full value. */
    destinationMasked: text('destination_masked').notNull(),
    /**
     * HMAC of the normalised destination. The strongest multi-accounting
     * signal available: twelve accounts cashing out to one PayPal address is
     * unambiguous in a way that shared IPs and fingerprints are not.
     */
    destinationHash: text('destination_hash').notNull(),

    state: payoutStateEnum('state').notNull().default('requested'),

    providerKey: text('provider_key'),
    providerReference: text('provider_reference'),
    providerPayload: jsonb('provider_payload'),

    reserveEntryId: uuid('reserve_entry_id').references(() => ledgerEntries.id),
    refundEntryId: uuid('refund_entry_id').references(() => ledgerEntries.id),

    /** Passed to the provider so a retried send never pays twice. */
    idempotencyKey: text('idempotency_key').notNull(),

    requestedIp: inet('requested_ip'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
    decidedByAdminId: uuid('decided_by_admin_id').references(() => adminUsers.id),
    settledAt: ts('settled_at'),
    failureReason: text('failure_reason'),
  },
  (t) => [
    uniqueIndex('payouts_idempotency_uq').on(t.idempotencyKey),
    index('payouts_user_idx').on(t.userId, t.requestedAt),
    index('payouts_state_idx').on(t.state, t.requestedAt),
    index('payouts_destination_hash_idx').on(t.destinationHash),
    index('payouts_provider_ref_idx').on(t.providerReference),
  ],
)

/** Append-only. Answers "who approved this and when" without guesswork. */
export const payoutTransitions = pgTable(
  'payout_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'cascade' }),
    fromState: payoutStateEnum('from_state'),
    toState: payoutStateEnum('to_state').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason'),
    details: jsonb('details'),
    createdAt: createdAt(),
  },
  (t) => [index('payout_transitions_payout_idx').on(t.payoutId, t.createdAt)],
)
