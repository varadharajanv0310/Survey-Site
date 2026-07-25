import { boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt, ts, updatedAt } from './_shared'
import { ticketKindEnum, ticketStatusEnum } from './enums'
import { adminUsers, users } from './identity'
import { networks } from './supply'

/**
 * "I completed the offer and never got my points" is the single highest
 * volume message a site in this category receives. Every competitor has a
 * structured claim form for it, because the alternative is answering it by
 * hand in an inbox forever.
 *
 * Structured fields matter: with the network, transaction id and timestamp,
 * most claims can be auto-resolved by looking the event up in
 * `postbackEvents` and telling the user exactly what the network did or did
 * not send.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: ticketKindEnum('kind').notNull(),
    subject: text('subject').notNull(),
    status: ticketStatusEnum('status').notNull().default('open'),

    /** Structured claim details for kind = 'missing_points'. */
    networkId: uuid('network_id').references(() => networks.id),
    externalTransactionId: text('external_transaction_id'),
    claimedOfferName: text('claimed_offer_name'),
    completedAt: ts('completed_at'),
    attachments: jsonb('attachments').$type<{ url: string; name: string }[]>(),

    assignedAdminId: uuid('assigned_admin_id').references(() => adminUsers.id),
    resolvedAt: ts('resolved_at'),
    resolutionNote: text('resolution_note'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_user_idx').on(t.userId, t.createdAt),
    index('tickets_queue_idx').on(t.status, t.kind, t.createdAt),
    index('tickets_txn_idx').on(t.externalTransactionId),
  ],
)

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id),
    authorAdminId: uuid('author_admin_id').references(() => adminUsers.id),
    body: text('body').notNull(),
    /** Internal notes are never shown to the user. */
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
)
