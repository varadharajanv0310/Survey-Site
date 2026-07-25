import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, ts, updatedAt } from './_shared'
import { networkKindEnum, offerCategoryEnum } from './enums'

/**
 * One row per supply partner (CPX Research, AdGate, Torox, ...).
 *
 * `secretRef` holds the NAME of the environment variable containing the
 * network's postback secret, never the secret itself. Live credentials must
 * not end up in database backups, seed files, or the admin UI.
 */
export const networks = pgTable(
  'networks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(), // 'cpx', 'adgate', 'sim_offer_wall'
    name: text('name').notNull(),
    kind: networkKindEnum('kind').notNull(),

    enabled: boolean('enabled').notNull().default(false),

    /** Our cut, in basis points. 3500 = we keep 35%, user gets 65%. */
    revenueShareBps: integer('revenue_share_bps').notNull().default(3500),

    /** Non-secret adapter config: app ids, endpoints, allowed postback IPs. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),

    secretRef: text('secret_ref'),

    /** Bumped when an adapter's parsing changes, so stored `raw` stays interpretable. */
    adapterVersion: integer('adapter_version').notNull().default(1),

    lastSyncedAt: ts('last_synced_at'),
    lastPostbackAt: ts('last_postback_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('networks_key_uq').on(t.key), index('networks_enabled_idx').on(t.enabled)],
)

/**
 * Offer-wall inventory, synced from a network's catalog API into our own store
 * so the user-facing feed never depends on a third party being up.
 *
 * Survey walls do not appear here — they have no catalog. See `wallPlacements`.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    networkId: uuid('network_id')
      .notNull()
      .references(() => networks.id, { onDelete: 'cascade' }),
    externalOfferId: text('external_offer_id').notNull(),

    title: text('title').notNull(),
    description: text('description'),
    requirements: text('requirements'),
    category: offerCategoryEnum('category').notNull().default('other'),
    iconUrl: text('icon_url'),

    /** What the network pays us, in USD micros. */
    grossUsdMicros: bigint('gross_usd_micros', { mode: 'number' }).notNull(),
    /** What we show the user, derived at sync time from revenue share + rate. */
    points: bigint('points', { mode: 'number' }).notNull(),
    configVersion: bigint('config_version', { mode: 'number' }).notNull().default(0),

    /** `{user_token}` is substituted per user at render time. */
    urlTemplate: text('url_template').notNull(),

    /**
     * Targeting. Showing a US-only offer to an Indian user produces a support
     * ticket and, repeated enough, a complaint from the network.
     */
    countries: text('countries').array(),
    excludedCountries: text('excluded_countries').array(),
    devices: text('devices').array(),

    estimatedMinutes: integer('estimated_minutes'),
    conversionRate: integer('conversion_rate_bps'),

    isActive: boolean('is_active').notNull().default(true),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),

    /** Untouched network payload, for debugging a bad mapping after the fact. */
    raw: jsonb('raw'),
  },
  (t) => [
    uniqueIndex('offers_network_external_uq').on(t.networkId, t.externalOfferId),
    index('offers_feed_idx').on(t.isActive, t.category, t.points),
    index('offers_network_idx').on(t.networkId),
  ],
)

/**
 * Survey-wall inventory. A placement is a signed iframe URL, not a list of
 * surveys — the wall's own JS decides what to show the user in real time.
 */
export const wallPlacements = pgTable(
  'wall_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    networkId: uuid('network_id')
      .notNull()
      .references(() => networks.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /** e.g. https://offers.example.com/wall?app_id=123&ext_user_id={user_token}&hash={hash} */
    urlTemplate: text('url_template').notNull(),

    /** How to build the signature the wall expects in its URL. */
    signingConfig: jsonb('signing_config').$type<Record<string, unknown>>().notNull().default({}),

    countries: text('countries').array(),
    excludedCountries: text('excluded_countries').array(),
    devices: text('devices').array(),

    sortOrder: integer('sort_order').notNull().default(0),
    enabled: boolean('enabled').notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('wall_placements_network_idx').on(t.networkId, t.enabled)],
)
