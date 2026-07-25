import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, ts, updatedAt } from './_shared'
import { adminRoleEnum, authEventKindEnum, deviceTypeEnum, userStatusEnum } from './enums'

/**
 * Deliberately has no balance column. Balance is derived from `ledgerEntries`
 * and nothing else. See packages/core/src/ledger.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Always stored lowercase and trimmed; normalisation happens in the auth service. */
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: ts('email_verified_at'),

    status: userStatusEnum('status').notNull().default('active'),
    statusReason: text('status_reason'),

    displayName: text('display_name'),

    /** ISO-3166-1 alpha-2, resolved from signup IP. Drives offer targeting. */
    country: text('country'),

    referralCode: text('referral_code').notNull(),
    referredByUserId: uuid('referred_by_user_id').references((): AnyPgColumn => users.id),

    signupIp: inet('signup_ip'),
    signupUserAgent: text('signup_user_agent'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_referral_code_uq').on(t.referralCode),
    index('users_referred_by_idx').on(t.referredByUserId),
    index('users_signup_ip_idx').on(t.signupIp),
    index('users_status_idx').on(t.status),
  ],
)

/**
 * Opaque server-side sessions rather than JWTs. A banned account has to lose
 * access immediately, and revoking a stateless token requires a denylist that
 * is just a session table with extra steps.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
)

/** Single table for both password-reset and email-verification tokens. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(), // 'password_reset' | 'email_verification'
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash),
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose),
  ],
)

/**
 * Append-only. This is the substrate for IP-velocity limits and duplicate
 * account detection, so it records failures as well as successes.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Present on login_failed where no user matched. */
    attemptedEmail: text('attempted_email'),
    kind: authEventKindEnum('kind').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    deviceFingerprint: text('device_fingerprint'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('auth_events_user_idx').on(t.userId, t.createdAt),
    index('auth_events_ip_idx').on(t.ip, t.createdAt),
    index('auth_events_fingerprint_idx').on(t.deviceFingerprint),
  ],
)

/**
 * Device fingerprints seen per user. Shared fingerprint across accounts is the
 * second strongest multi-accounting signal we have; the strongest is a shared
 * payout destination (see `payouts.destinationHash`).
 */
export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    deviceType: deviceTypeEnum('device_type'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    seenCount: integer('seen_count').notNull().default(1),
  },
  (t) => [
    uniqueIndex('user_devices_user_fingerprint_uq').on(t.userId, t.fingerprint),
    index('user_devices_fingerprint_idx').on(t.fingerprint),
  ],
)

/** Separate from `users` so an admin compromise is not a user compromise. */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: adminRoleEnum('role').notNull().default('viewer'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('admin_users_email_uq').on(t.email)],
)

/**
 * Separate from `sessions` rather than sharing it with a nullable user_id.
 * Keeping the two apart means a query that forgets to filter by principal type
 * cannot accidentally treat a user session as an admin one.
 *
 * Shorter TTL than user sessions: an admin session can approve payouts.
 */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('admin_sessions_token_hash_uq').on(t.tokenHash),
    index('admin_sessions_admin_idx').on(t.adminId),
  ],
)

/** Every mutating admin action. Append-only. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => adminUsers.id),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_admin_idx').on(t.adminId, t.createdAt),
    index('audit_log_subject_idx').on(t.subjectType, t.subjectId),
  ],
)
