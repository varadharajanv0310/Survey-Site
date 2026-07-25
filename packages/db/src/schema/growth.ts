import { bigint, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, ts } from './_shared'
import { users } from './identity'
import { ledgerEntries } from './ledger'

/**
 * Attribution is permanent and one-way: `refereeUserId` is unique, so a user
 * has exactly one referrer for life and cannot be re-attributed later.
 *
 * `qualifiedAt` exists because paying the bonus at signup is free money for
 * anyone with a disposable email address. The bonus fires once the referee
 * has actually earned something.
 */
export const referrals = pgTable(
  'referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referrerUserId: uuid('referrer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refereeUserId: uuid('referee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeUsed: text('code_used').notNull(),

    attributedAt: ts('attributed_at').notNull().defaultNow(),
    qualifiedAt: ts('qualified_at'),
    bonusEntryId: uuid('bonus_entry_id').references(() => ledgerEntries.id),

    /** Running total of commission paid to the referrer from this referee. */
    lifetimeCommissionPoints: bigint('lifetime_commission_points', { mode: 'number' })
      .notNull()
      .default(0),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('referrals_referee_uq').on(t.refereeUserId),
    index('referrals_referrer_idx').on(t.referrerUserId),
  ],
)

/**
 * Daily bonus / streak claims. Retention mechanics are not decoration in this
 * category — daily bonuses, streaks and levels are most of why a user opens
 * the site on day 30 rather than day 1.
 *
 * The unique index on (user, date) is what makes the claim idempotent against
 * a double-tap; the ledger idempotency key backs it up.
 */
export const dailyClaims = pgTable(
  'daily_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Claim day in UTC. */
    claimDate: date('claim_date').notNull(),
    streakDay: integer('streak_day').notNull().default(1),
    pointsAwarded: bigint('points_awarded', { mode: 'number' }).notNull(),
    entryId: uuid('entry_id').references(() => ledgerEntries.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('daily_claims_user_date_uq').on(t.userId, t.claimDate),
    index('daily_claims_user_idx').on(t.userId, t.claimDate),
  ],
)
