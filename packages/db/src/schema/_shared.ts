import { customType, timestamp } from 'drizzle-orm/pg-core'

/** Postgres `bytea`. Used for raw postback bodies, which we keep byte-exact. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/**
 * Every timestamp in this database is `timestamptz`. Offer targeting, hold
 * windows and velocity checks all reason about wall-clock time across
 * timezones; a naive timestamp would silently do the wrong thing.
 */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const createdAt = () => ts('created_at').notNull().defaultNow()
export const updatedAt = () => ts('updated_at').notNull().defaultNow()

/**
 * Money is integer micros of USD (1_000_000 = $1.00). Points are integers.
 * No float ever touches money or points, at any layer.
 *
 * Micros rather than cents because network payouts are routinely quoted at
 * fractions of a cent (a screenout worth $0.004), and rounding those to cents
 * at ingestion loses real revenue across millions of events.
 */
export type Micros = number
