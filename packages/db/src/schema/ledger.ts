import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, ts } from './_shared'
import { ledgerEntryStatusEnum, ledgerEntryTypeEnum } from './enums'
import { adminUsers, users } from './identity'
import { completions } from './ingestion'
import { networks } from './supply'

/**
 * The single source of truth for points. There is no balance column anywhere
 * in this database; balance is a query over this table.
 *
 * Rules this schema enforces, rather than trusting application code to honour:
 *
 *  - Amounts are never edited and rows are never deleted. A clawback is a new
 *    negative row pointing at the row it offsets. (Enforced by trigger in
 *    migration 0001, since Drizzle cannot express it.)
 *  - `status` moves forward only: pending -> posted | rejected, posted -> void.
 *    This is the one mutable field, and it is the deliberate exception to
 *    strict append-only. Everything that protects us — amount history,
 *    reversal lineage — stays immutable.
 *  - Every write carries an `idempotencyKey`. Networks retry, users
 *    double-click, and the worker can crash between the ledger write and the
 *    ack. The unique index is the only thing standing between us and paying
 *    for the same completion four times.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    /** Signed. Positive credits the user, negative debits them. Never zero. */
    amountPoints: bigint('amount_points', { mode: 'number' }).notNull(),

    type: ledgerEntryTypeEnum('type').notNull(),
    status: ledgerEntryStatusEnum('status').notNull().default('posted'),

    /**
     * Composed deterministically by the caller rather than relying on a
     * natural key, because reversals reuse the original transaction id:
     *
     *   earn:{network}:{txn}
     *   screenout:{network}:{txn}
     *   reversal:{network}:{txn}:{reversal_event_id}
     *   redeem:{payout_id}
     *   redeem_refund:{payout_id}
     *   referral_bonus:{referrer_id}:{referee_id}
     *   referral_commission:{referrer_id}:{source_entry_id}
     *   bonus:daily:{user_id}:{yyyy-mm-dd}
     *   manual:{admin_id}:{client_uuid}
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /**
     * Points are posted immediately so the user sees them, but are not
     * withdrawable until this moment passes. Offer walls claw back 5-15% of
     * revenue days after crediting; without a hold window every reversal
     * lands after the money has already left.
     *
     * Balance therefore has two flavours: total posted, and withdrawable.
     */
    availableAt: ts('available_at').notNull().defaultNow(),

    networkId: uuid('network_id').references(() => networks.id),
    completionId: uuid('completion_id').references(() => completions.id),
    payoutId: uuid('payout_id'),
    referralId: uuid('referral_id'),

    /** Set on reversals: the entry this one offsets. */
    reversesEntryId: uuid('reverses_entry_id').references((): AnyPgColumn => ledgerEntries.id),

    /** Denormalised from the completion purely to make support lookups fast. */
    externalTransactionId: text('external_transaction_id'),

    configVersion: bigint('config_version', { mode: 'number' }).notNull().default(0),

    note: text('note'),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id),

    createdAt: createdAt(),
    postedAt: ts('posted_at'),
    statusChangedAt: ts('status_changed_at'),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_uq').on(t.idempotencyKey),

    /** The balance query. Partial, because only posted rows count. */
    index('ledger_entries_balance_idx')
      .on(t.userId, t.availableAt)
      .where(sql`status = 'posted'`),

    index('ledger_entries_user_history_idx').on(t.userId, t.createdAt),
    index('ledger_entries_completion_idx').on(t.completionId),
    index('ledger_entries_payout_idx').on(t.payoutId),
    index('ledger_entries_reverses_idx').on(t.reversesEntryId),
    index('ledger_entries_status_idx').on(t.status).where(sql`status = 'pending'`),
    index('ledger_entries_external_txn_idx').on(t.externalTransactionId),

    check('ledger_entries_amount_nonzero', sql`amount_points <> 0`),

    /**
     * Sign must match intent. This has caught more bugs in this class of
     * system than any test: a reversal written with a positive amount pays
     * the user twice for fraud.
     */
    check(
      'ledger_entries_sign_matches_type',
      sql`(
        (type IN ('earn','screenout','bonus','referral_bonus','referral_commission','redeem_refund') AND amount_points > 0)
        OR (type IN ('reversal','redeem') AND amount_points < 0)
        OR (type = 'manual_adjustment')
      )`,
    ),

    check(
      'ledger_entries_reversal_has_target',
      sql`(type <> 'reversal') OR (reverses_entry_id IS NOT NULL)`,
    ),
  ],
)
