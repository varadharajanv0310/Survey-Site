import { bigint, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt, ts } from './_shared'
import {
  fraudSubjectTypeEnum,
  fraudVerdictEnum,
  reviewResolutionEnum,
  reviewStateEnum,
} from './enums'
import { adminUsers, users } from './identity'

/**
 * One row per time the pipeline formed an opinion about something.
 *
 * Note where this gets applied. Fraud on the earning side costs us margin;
 * fraud on the payout side costs us cash. The same pipeline runs at both
 * points, but the payout gate is the one that actually protects money, and
 * it is allowed to be stricter.
 *
 * The second cost is not money at all: advertisers complain to networks about
 * junk conversions, and networks drop publishers who send it. Bad fraud
 * control does not shrink the margin, it removes the supply.
 */
export const fraudEvaluations = pgTable(
  'fraud_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: fraudSubjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    userId: uuid('user_id').references(() => users.id),

    verdict: fraudVerdictEnum('verdict').notNull(),
    score: integer('score').notNull().default(0),
    configVersion: bigint('config_version', { mode: 'number' }).notNull().default(0),
    durationMs: integer('duration_ms'),

    createdAt: createdAt(),
  },
  (t) => [
    index('fraud_evaluations_subject_idx').on(t.subjectType, t.subjectId),
    index('fraud_evaluations_user_idx').on(t.userId, t.createdAt),
    index('fraud_evaluations_verdict_idx').on(t.verdict, t.createdAt),
  ],
)

/**
 * Per-check output, kept so a rule can be tuned against history rather than
 * guessed at. When we later want to know "how many good users would this
 * threshold have blocked", the answer has to already be in the database.
 */
export const fraudCheckResults = pgTable(
  'fraud_check_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => fraudEvaluations.id, { onDelete: 'cascade' }),
    checkKey: text('check_key').notNull(),
    verdict: fraudVerdictEnum('verdict').notNull(),
    scoreDelta: integer('score_delta').notNull().default(0),
    details: jsonb('details'),
    durationMs: integer('duration_ms'),
    error: text('error'),
  },
  (t) => [
    index('fraud_check_results_eval_idx').on(t.evaluationId),
    index('fraud_check_results_key_idx').on(t.checkKey, t.verdict),
  ],
)

/**
 * The admin review queue. A 'review' verdict holds the credit in a pending
 * ledger entry rather than rejecting it — most flagged users are real people
 * on a shared IP, and silently eating their points is how a rewards site
 * earns a reputation for not paying.
 */
export const reviewItems = pgTable(
  'review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: fraudSubjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    userId: uuid('user_id').references(() => users.id),
    evaluationId: uuid('evaluation_id').references(() => fraudEvaluations.id),

    reason: text('reason').notNull(),
    priority: integer('priority').notNull().default(0),

    state: reviewStateEnum('state').notNull().default('open'),
    resolution: reviewResolutionEnum('resolution'),
    resolvedByAdminId: uuid('resolved_by_admin_id').references(() => adminUsers.id),
    resolvedAt: ts('resolved_at'),
    notes: text('notes'),

    createdAt: createdAt(),
  },
  (t) => [
    index('review_items_queue_idx').on(t.state, t.priority, t.createdAt),
    index('review_items_subject_idx').on(t.subjectType, t.subjectId),
    index('review_items_user_idx').on(t.userId),
  ],
)
