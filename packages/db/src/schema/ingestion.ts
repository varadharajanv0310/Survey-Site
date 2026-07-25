import {
  bigint,
  boolean,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { bytea, createdAt, ts } from './_shared'
import {
  completionKindEnum,
  completionStatusEnum,
  postbackDedupeOutcomeEnum,
  postbackParseStatusEnum,
} from './enums'
import { networks, offers } from './supply'
import { users } from './identity'

/**
 * Every inbound postback hit, including malformed ones, bad signatures and
 * retries. Append-only, never deduplicated.
 *
 * This exists because the expensive failure in this system is a credit that
 * should have happened and didn't: the user complains, and without the raw
 * bytes there is no way to tell whether the network sent it, whether our
 * signature check was wrong, or whether the user is lying. Keeping the exact
 * body also means a signature bug can be replayed against a fixed parser.
 *
 * Retention is a real concern at volume — a pruning job for rows older than
 * N days that resulted in a successful credit comes later.
 */
export const postbackEvents = pgTable(
  'postback_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Null when the URL did not resolve to a known network. */
    networkId: uuid('network_id').references(() => networks.id),
    networkKeyRaw: text('network_key_raw'),

    receivedAt: ts('received_at').notNull().defaultNow(),
    remoteIp: inet('remote_ip'),
    method: text('method').notNull(),
    path: text('path').notNull(),
    queryString: text('query_string'),
    headers: jsonb('headers').$type<Record<string, string>>(),
    /** Byte-exact. Signatures are computed over raw bytes, not reserialised JSON. */
    rawBody: bytea('raw_body'),

    signatureValid: boolean('signature_valid'),
    parseStatus: postbackParseStatusEnum('parse_status').notNull(),
    parseError: text('parse_error'),

    dedupeOutcome: postbackDedupeOutcomeEnum('dedupe_outcome').notNull(),
    completionId: uuid('completion_id'),

    /** Milliseconds spent on the request thread. Watched: this must stay small. */
    handledInMs: bigint('handled_in_ms', { mode: 'number' }),
  },
  (t) => [
    index('postback_events_network_idx').on(t.networkId, t.receivedAt),
    index('postback_events_outcome_idx').on(t.dedupeOutcome, t.receivedAt),
    index('postback_events_completion_idx').on(t.completionId),
    index('postback_events_ip_idx').on(t.remoteIp, t.receivedAt),
  ],
)

/**
 * The canonical, deduplicated event. One row per distinct thing a network told
 * us happened.
 *
 * Kept separate from `ledgerEntries` because a single completion can produce
 * several ledger entries over its life — credited, reversed three days later,
 * manually re-credited after the user disputes it. Collapsing the event and
 * the money into one row makes a routine clawback a schema problem.
 */
export const completions = pgTable(
  'completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    networkId: uuid('network_id')
      .notNull()
      .references(() => networks.id),
    externalTransactionId: text('external_transaction_id').notNull(),
    kind: completionKindEnum('kind').notNull(),

    /**
     * Networks reuse the original transaction id when reversing. Empty string
     * for credits — deliberately not null, because Postgres treats NULLs as
     * distinct in a unique index and would let every duplicate through.
     * Set from the network's own reversal event id when present, otherwise
     * derived, so two partial clawbacks on one transaction are distinct rows.
     */
    reversalEventId: text('reversal_event_id').notNull().default(''),

    /** Null when the signed user token did not resolve to an account. */
    userId: uuid('user_id').references(() => users.id),
    userTokenRaw: text('user_token_raw'),

    offerId: uuid('offer_id').references(() => offers.id),
    externalOfferId: text('external_offer_id'),

    /** What the network says it is paying us, in USD micros. */
    grossUsdMicros: bigint('gross_usd_micros', { mode: 'number' }).notNull(),
    /** What we decided to give the user, at `configVersion`. */
    pointsAwarded: bigint('points_awarded', { mode: 'number' }).notNull().default(0),
    configVersion: bigint('config_version', { mode: 'number' }).notNull().default(0),

    status: completionStatusEnum('status').notNull().default('received'),

    /** When the network says it happened, which is not when we received it. */
    occurredAt: ts('occurred_at'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),

    ip: inet('ip'),
    userAgent: text('user_agent'),

    adapterVersion: bigint('adapter_version', { mode: 'number' }).notNull().default(1),
    raw: jsonb('raw'),
  },
  (t) => [
    /**
     * The deduplication boundary. A credit and its later reversal share a
     * transaction id, so `kind` is part of the key; `reversalEventId` is
     * included (empty string for credits, never null) so two distinct partial
     * clawbacks on one transaction can both land.
     */
    uniqueIndex('completions_dedupe_uq').on(
      t.networkId,
      t.externalTransactionId,
      t.kind,
      t.reversalEventId,
    ),
    index('completions_user_idx').on(t.userId, t.receivedAt),
    index('completions_status_idx').on(t.status, t.receivedAt),
    index('completions_network_idx').on(t.networkId, t.receivedAt),
    index('completions_txn_idx').on(t.externalTransactionId),
  ],
)
