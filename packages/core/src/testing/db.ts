import { sql } from 'drizzle-orm'
import { createDb, type Database } from '@app/db'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://rewards:rewards@localhost:5433/rewards'

export function testDb(): Database {
  return createDb(TEST_DATABASE_URL)
}

/**
 * TRUNCATE rather than DELETE: the ledger has a BEFORE DELETE trigger that
 * refuses row deletion, and it should. TRUNCATE fires statement-level triggers
 * only, so it is the sanctioned way to reset a test database without weakening
 * the guarantee we are trying to test.
 */
export async function resetDb(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      ledger_entries, completions, postback_events, payouts, payout_transitions,
      fraud_evaluations, fraud_check_results, review_items,
      referrals, daily_claims, tickets, ticket_messages,
      sessions, auth_tokens, auth_events, user_devices, users,
      offers, wall_placements, networks, audit_log
    RESTART IDENTITY CASCADE
  `)
}

let userSeq = 0

export async function makeUser(
  db: Database,
  overrides: Partial<{ email: string; country: string }> = {},
): Promise<string> {
  userSeq += 1
  const rows = (await db.execute(sql`
    INSERT INTO users (email, password_hash, referral_code, country)
    VALUES (
      ${overrides.email ?? `user${userSeq}-${Date.now()}@test.local`},
      'not-a-real-hash',
      ${`TEST${userSeq}${Date.now().toString(36).toUpperCase()}`},
      ${overrides.country ?? 'US'}
    )
    RETURNING id
  `)) as unknown as { id: string }[]
  return rows[0]!.id
}

export async function makeNetwork(
  db: Database,
  overrides: Partial<{ key: string; kind: 'survey_wall' | 'offer_wall' }> = {},
): Promise<string> {
  userSeq += 1
  const rows = (await db.execute(sql`
    INSERT INTO networks (key, name, kind, enabled)
    VALUES (
      ${overrides.key ?? `net${userSeq}`},
      'Test Network',
      ${overrides.kind ?? 'offer_wall'},
      true
    )
    RETURNING id
  `)) as unknown as { id: string }[]
  return rows[0]!.id
}
