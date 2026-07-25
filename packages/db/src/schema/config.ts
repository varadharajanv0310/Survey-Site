import { bigint, bigserial, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt, updatedAt } from './_shared'
import { adminUsers } from './identity'

/**
 * Conversion rates, per-network revenue share, redemption minimums, hold
 * windows and fraud thresholds all live here. Nothing that a business person
 * might want to change belongs in a literal inside business logic.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  valueType: text('value_type').notNull(), // 'number' | 'string' | 'boolean' | 'json'
  description: text('description'),
  updatedAt: updatedAt(),
  updatedByAdminId: uuid('updated_by_admin_id').references(() => adminUsers.id),
})

/**
 * Append-only history of every settings change, and the source of the global
 * config version counter.
 *
 * Ledger entries and completions record the `configVersion` they were priced
 * under. Without that, changing the points-per-dollar rate silently re-prices
 * history the next time anyone recomputes anything, and reconciling a
 * network's invoice against our own numbers becomes impossible.
 */
export const settingsVersions = pgTable(
  'settings_versions',
  {
    version: bigserial('version', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    previousValue: jsonb('previous_value'),
    value: jsonb('value').notNull(),
    changedByAdminId: uuid('changed_by_admin_id').references(() => adminUsers.id),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('settings_versions_key_idx').on(t.key, t.version)],
)

/** Convenience type for the `configVersion` foreign-ish column used elsewhere. */
export const configVersionColumn = (name = 'config_version') =>
  bigint(name, { mode: 'number' }).notNull().default(0)
