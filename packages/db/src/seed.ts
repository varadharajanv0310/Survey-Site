/**
 * Seeds a database that looks like a site that has been running for a month,
 * not a blank one.
 *
 * Every screen should have something on it on first run, including the awkward
 * ones: a user with points on hold, a payout stuck in review, a completion
 * that got clawed back, an open missing-points ticket.
 */
import { sql } from 'drizzle-orm'
import { createDb } from './index'
import {
  AdminAuthService,
  DEFAULT_SETTINGS,
  LedgerService,
  SettingsService,
  awardPoints,
  hashPassword,
  ledgerKeys,
  generateReferralCode,
  hashDestination,
  maskDestination,
} from '@app/core'
import {
  completions,
  dailyClaims,
  networks,
  offers,
  payouts,
  payoutTransitions,
  referrals,
  reviewItems,
  ticketMessages,
  tickets,
  users,
  wallPlacements,
} from './schema/index'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://rewards:rewards@localhost:5433/rewards')
const USER_TOKEN_SECRET = process.env.USER_TOKEN_SECRET ?? 'dev-only-change-me-usertoken'

const settingsService = new SettingsService(db)
const ledger = new LedgerService(db, { allowNegativeBalance: false })
const adminAuth = new AdminAuthService(db)

const S = DEFAULT_SETTINGS

/**
 * Seed timestamps are historical, so computing them in JS is fine — the
 * app-vs-database clock skew that matters for hold windows is irrelevant when
 * backdating a row by three weeks.
 */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)

console.log('clearing existing data...')
// TRUNCATE, not DELETE: the ledger refuses row deletion by trigger, and it
// should. TRUNCATE fires statement-level triggers only.
await db.execute(sql`
  TRUNCATE TABLE
    ledger_entries, completions, postback_events, payouts, payout_transitions,
    fraud_evaluations, fraud_check_results, review_items,
    referrals, daily_claims, tickets, ticket_messages,
    sessions, admin_sessions, auth_tokens, auth_events, user_devices, users,
    offers, wall_placements, networks, audit_log, admin_users,
    settings, settings_versions
  RESTART IDENTITY CASCADE
`)

await settingsService.seedDefaults()

// --- admins -----------------------------------------------------------------

const adminId = await adminAuth.create('admin@example.com', 'admin12345', 'superadmin')
await adminAuth.create('reviewer@example.com', 'review12345', 'reviewer')
console.log('admins: admin@example.com / admin12345, reviewer@example.com / review12345')

// --- networks ---------------------------------------------------------------

const [offerWall] = await db
  .insert(networks)
  .values({
    key: 'sim_offer_wall',
    name: 'Simulated Offer Wall',
    kind: 'offer_wall',
    enabled: true,
    revenueShareBps: 3500,
    config: { catalog_url: 'https://sim-offer-wall.local/api/offers' },
    // The name of an env var, never the secret itself.
    secretRef: 'SIM_OFFER_WALL_SECRET',
  })
  .returning()

const [surveyWall] = await db
  .insert(networks)
  .values({
    key: 'sim_survey_wall',
    name: 'Simulated Survey Wall',
    kind: 'survey_wall',
    enabled: true,
    // Survey walls typically give the user a larger share than offer walls.
    revenueShareBps: 4500,
    config: { app_id: 'sim-app-77', wall_url: 'https://sim-survey-wall.local/wall' },
    secretRef: 'SIM_SURVEY_WALL_SECRET',
  })
  .returning()

// A third network, deliberately disabled, so the admin toggle has something
// meaningful to switch on.
await db.insert(networks).values({
  key: 'sim_offer_wall_b',
  name: 'Simulated Offer Wall B (pending approval)',
  kind: 'offer_wall',
  enabled: false,
  revenueShareBps: 3000,
  config: {},
  secretRef: null,
})

await db.insert(wallPlacements).values({
  networkId: surveyWall!.id,
  name: 'Surveys',
  urlTemplate: 'https://sim-survey-wall.local/wall?app_id=sim-app-77&ext_user_id={user_token}',
  signingConfig: { algorithm: 'hmac-sha256', fields: ['app_id', 'ext_user_id'] },
  enabled: true,
  sortOrder: 0,
})

// --- offers -----------------------------------------------------------------

const CATALOG = [
  ['sow-1001', 'Coin Master — reach village 5', 'game', 4_200_000, ['US', 'CA', 'GB', 'AU'], ['mobile'], 90],
  ['sow-1002', 'MyPoints — complete registration', 'signup', 1_150_000, ['US'], ['desktop', 'mobile'], 5],
  ['sow-1003', 'Temu — first order', 'purchase', 12_500_000, ['US', 'GB', 'DE', 'IN'], ['desktop', 'mobile', 'tablet'], 15],
  ['sow-1004', 'Solitaire Cash — play 3 games', 'game', 850_000, ['US', 'IN'], ['mobile'], 20],
  ['sow-1005', 'Streaming trial — 7 days', 'signup', 8_000_000, ['US', 'CA'], ['desktop', 'mobile'], 10],
  ['sow-1006', 'Grocery app — install and open', 'app_install', 320_000, ['IN'], ['mobile'], 3],
] as const

const offerIds: Record<string, string> = {}
for (const [externalId, title, category, gross, countries, devices, minutes] of CATALOG) {
  const points = awardPoints({
    grossUsdMicros: gross,
    revenueShareBps: offerWall!.revenueShareBps,
    pointsPerUsd: S.points_per_usd,
    minAwardPoints: S.min_award_points,
  })
  const [row] = await db
    .insert(offers)
    .values({
      networkId: offerWall!.id,
      externalOfferId: externalId,
      title,
      description: `${title} — complete the requirements to earn.`,
      requirements: 'New users only. Reversals apply if the action is cancelled.',
      category: category as 'game',
      grossUsdMicros: gross,
      points,
      urlTemplate: `https://sim-offer-wall.local/click?offer=${externalId}&sub_id={user_token}`,
      countries: [...countries],
      devices: [...devices],
      estimatedMinutes: minutes,
      isActive: true,
      raw: { source: 'seed' },
    })
    .returning({ id: offers.id })
  offerIds[externalId] = row!.id
}

// --- users ------------------------------------------------------------------

const password = await hashPassword('password123')

type SeedUser = {
  email: string
  country: string
  verified: boolean
  status: 'active' | 'suspended' | 'banned'
}

const SEED_USERS: SeedUser[] = [
  { email: 'demo@example.com', country: 'US', verified: true, status: 'active' },
  { email: 'priya@example.com', country: 'IN', verified: true, status: 'active' },
  { email: 'marcus@example.com', country: 'GB', verified: true, status: 'active' },
  { email: 'unverified@example.com', country: 'US', verified: false, status: 'active' },
  { email: 'newbie@example.com', country: 'CA', verified: true, status: 'active' },
  { email: 'flagged@example.com', country: 'US', verified: true, status: 'active' },
  { email: 'banned@example.com', country: 'US', verified: true, status: 'banned' },
]

const userIds: Record<string, string> = {}
for (const u of SEED_USERS) {
  const [row] = await db
    .insert(users)
    .values({
      email: u.email,
      passwordHash: password,
      referralCode: generateReferralCode(),
      country: u.country,
      status: u.status,
      emailVerifiedAt: u.verified ? new Date() : null,
      signupIp: u.email === 'flagged@example.com' ? '203.0.113.7' : '198.51.100.4',
      statusReason: u.status === 'banned' ? 'multiple accounts, shared payout destination' : null,
    })
    .returning({ id: users.id })
  userIds[u.email] = row!.id
}

// Referral: demo referred newbie and priya.
for (const referee of ['newbie@example.com', 'priya@example.com']) {
  await db.insert(referrals).values({
    referrerUserId: userIds['demo@example.com']!,
    refereeUserId: userIds[referee]!,
    codeUsed: 'SEEDCODE',
    qualifiedAt: referee === 'priya@example.com' ? new Date() : null,
  })
  await db
    .update(users)
    .set({ referredByUserId: userIds['demo@example.com']! })
    .where(sql`id = ${userIds[referee]!}`)
}

// --- earnings history -------------------------------------------------------

let txCounter = 0
const nextTx = () => `seed-tx-${(txCounter += 1).toString().padStart(5, '0')}`

async function seedCompletion(args: {
  email: string
  networkId: string
  networkKey: string
  offerExternalId?: string
  grossUsdMicros: number
  kind: 'credit' | 'screenout'
  revenueShareBps: number
  daysAgo: number
  held?: boolean
  holdHours?: number
}) {
  const userId = userIds[args.email]!
  const txId = nextTx()
  const points = awardPoints({
    grossUsdMicros: args.grossUsdMicros,
    revenueShareBps: args.revenueShareBps,
    pointsPerUsd: S.points_per_usd,
    minAwardPoints: S.min_award_points,
  })

  const [completion] = await db
    .insert(completions)
    .values({
      networkId: args.networkId,
      externalTransactionId: txId,
      kind: args.kind,
      reversalEventId: '',
      userId,
      offerId: args.offerExternalId ? offerIds[args.offerExternalId]! : null,
      externalOfferId: args.offerExternalId ?? null,
      grossUsdMicros: args.grossUsdMicros,
      pointsAwarded: points,
      status: args.held ? 'pending_review' : 'credited',
      occurredAt: daysAgo(args.daysAgo),
      receivedAt: daysAgo(args.daysAgo),
      ip: '198.51.100.4',
      raw: { source: 'seed' },
    })
    .returning({ id: completions.id })

  const entry = await ledger.record({
    userId,
    amountPoints: points,
    type: args.kind === 'screenout' ? 'screenout' : 'earn',
    idempotencyKey:
      args.kind === 'screenout'
        ? ledgerKeys.screenout(args.networkKey, txId)
        : ledgerKeys.earn(args.networkKey, txId),
    status: args.held ? 'pending' : 'posted',
    ...(args.holdHours ? { holdHours: args.holdHours } : {}),
    networkId: args.networkId,
    completionId: completion!.id,
    externalTransactionId: txId,
  })

  return { entryId: entry.entry.id, completionId: completion!.id, points, txId }
}

console.log('seeding earnings...')

// demo@ — the richest history, so the demo account shows every state.
for (let i = 0; i < 6; i += 1) {
  await seedCompletion({
    email: 'demo@example.com',
    networkId: offerWall!.id,
    networkKey: 'sim_offer_wall',
    offerExternalId: CATALOG[i % CATALOG.length]![0],
    grossUsdMicros: CATALOG[i % CATALOG.length]![3],
    kind: 'credit',
    revenueShareBps: offerWall!.revenueShareBps,
    daysAgo: 20 - i * 3,
  })
}

// Survey completions and the far more common screenouts.
for (let i = 0; i < 4; i += 1) {
  await seedCompletion({
    email: 'demo@example.com',
    networkId: surveyWall!.id,
    networkKey: 'sim_survey_wall',
    grossUsdMicros: 1_350_000,
    kind: 'credit',
    revenueShareBps: surveyWall!.revenueShareBps,
    daysAgo: 12 - i * 2,
  })
}
for (let i = 0; i < 9; i += 1) {
  await seedCompletion({
    email: 'demo@example.com',
    networkId: surveyWall!.id,
    networkKey: 'sim_survey_wall',
    grossUsdMicros: 4_000,
    kind: 'screenout',
    revenueShareBps: surveyWall!.revenueShareBps,
    daysAgo: 10 - i,
  })
}

// Points still inside their hold window, so the two-balance display is visible.
await seedCompletion({
  email: 'demo@example.com',
  networkId: offerWall!.id,
  networkKey: 'sim_offer_wall',
  offerExternalId: 'sow-1003',
  grossUsdMicros: 12_500_000,
  kind: 'credit',
  revenueShareBps: offerWall!.revenueShareBps,
  daysAgo: 0,
  holdHours: 72,
})

// A clawback three days after the fact — the case the schema exists for.
const clawedBack = await seedCompletion({
  email: 'demo@example.com',
  networkId: offerWall!.id,
  networkKey: 'sim_offer_wall',
  offerExternalId: 'sow-1005',
  grossUsdMicros: 8_000_000,
  kind: 'credit',
  revenueShareBps: offerWall!.revenueShareBps,
  daysAgo: 5,
})
await db.insert(completions).values({
  networkId: offerWall!.id,
  externalTransactionId: clawedBack.txId,
  kind: 'reversal',
  reversalEventId: 'seed-rev-1',
  userId: userIds['demo@example.com']!,
  grossUsdMicros: 8_000_000,
  status: 'reversed',
  raw: { source: 'seed', reason: 'trial cancelled within 7 days' },
})
await ledger.reverse({
  entryId: clawedBack.entryId,
  idempotencyKey: ledgerKeys.reversal('sim_offer_wall', clawedBack.txId, 'seed-rev-1'),
  reason: 'trial cancelled within 7 days',
  externalTransactionId: clawedBack.txId,
})

// Other users, lighter histories.
for (const email of ['priya@example.com', 'marcus@example.com', 'newbie@example.com']) {
  const count = email === 'newbie@example.com' ? 1 : 4
  for (let i = 0; i < count; i += 1) {
    await seedCompletion({
      email,
      networkId: i % 2 === 0 ? offerWall!.id : surveyWall!.id,
      networkKey: i % 2 === 0 ? 'sim_offer_wall' : 'sim_survey_wall',
      ...(i % 2 === 0 ? { offerExternalId: 'sow-1004' } : {}),
      grossUsdMicros: i % 2 === 0 ? 850_000 : 1_350_000,
      kind: 'credit',
      revenueShareBps: i % 2 === 0 ? offerWall!.revenueShareBps : surveyWall!.revenueShareBps,
      daysAgo: 14 - i * 3,
    })
  }
}

// flagged@ — a held credit sitting in the fraud review queue.
const heldResult = await seedCompletion({
  email: 'flagged@example.com',
  networkId: offerWall!.id,
  networkKey: 'sim_offer_wall',
  offerExternalId: 'sow-1003',
  grossUsdMicros: 12_500_000,
  kind: 'credit',
  revenueShareBps: offerWall!.revenueShareBps,
  daysAgo: 1,
  held: true,
})
await db.insert(reviewItems).values({
  subjectType: 'completion',
  subjectId: heldResult.completionId,
  userId: userIds['flagged@example.com']!,
  reason: 'ip_completion_velocity(review +25), duplicate_device(review +36)',
  priority: 61,
  state: 'open',
})

// --- daily bonus streak -----------------------------------------------------

for (let day = 4; day >= 1; day -= 1) {
  const points = S.daily_bonus_base_points + (5 - day - 1) * S.daily_bonus_streak_bonus_points
  // The ::int cast is required: in `date - $1` Postgres has no way to infer
  // the parameter's type, and the driver fails while binding it.
  const [dateRow] = (await db.execute(
    sql`SELECT ((now() AT TIME ZONE 'UTC')::date - ${day}::int)::TEXT AS d`,
  )) as unknown as { d: string }[]

  const entry = await ledger.record({
    userId: userIds['demo@example.com']!,
    amountPoints: points,
    type: 'bonus',
    idempotencyKey: ledgerKeys.dailyBonus(userIds['demo@example.com']!, dateRow!.d),
    note: `daily bonus, streak day ${5 - day}`,
  })
  await db.insert(dailyClaims).values({
    userId: userIds['demo@example.com']!,
    claimDate: dateRow!.d,
    streakDay: 5 - day,
    pointsAwarded: points,
    entryId: entry.entry.id,
  })
}

// --- payouts ----------------------------------------------------------------

console.log('seeding payouts...')

async function seedPayout(args: {
  email: string
  points: number
  state: 'requested' | 'under_review' | 'approved' | 'paid' | 'failed'
  method: 'paypal' | 'upi' | 'giftcard'
  destination: string
  daysAgo: number
}) {
  const userId = userIds[args.email]!
  const payoutId = crypto.randomUUID()

  const reserve = await ledger.reserveForPayout({
    userId,
    points: args.points,
    payoutId,
    idempotencyKey: ledgerKeys.redeem(payoutId),
  })

  await db.insert(payouts).values({
    id: payoutId,
    userId,
    requestedPoints: args.points,
    amountMinor: Math.floor((args.points * 100) / S.points_per_usd),
    currency: 'USD',
    method: args.method,
    destinationMasked: maskDestination(args.destination),
    destinationHash: hashDestination(args.destination, USER_TOKEN_SECRET),
    state: args.state,
    providerKey: 'mock',
    providerReference: args.state === 'paid' ? `mock_${payoutId.slice(0, 16)}` : null,
    reserveEntryId: reserve.entry.id,
    idempotencyKey: `payout:${payoutId}`,
    requestedAt: daysAgo(args.daysAgo),
    settledAt: args.state === 'paid' ? new Date() : null,
    failureReason: args.state === 'failed' ? 'recipient account is closed' : null,
  })

  await db.insert(payoutTransitions).values({
    payoutId,
    fromState: null,
    toState: 'requested',
    actorType: 'user',
    actorId: userId,
    reason: 'payout requested',
  })

  if (args.state === 'under_review') {
    await db.insert(reviewItems).values({
      subjectType: 'payout',
      subjectId: payoutId,
      userId,
      reason: 'new_account_payout(review +55)',
      priority: 100,
      state: 'open',
    })
  }

  return payoutId
}

await seedPayout({
  email: 'demo@example.com',
  points: 2_000,
  state: 'paid',
  method: 'paypal',
  destination: 'demo@example.com',
  daysAgo: 9,
})
await seedPayout({
  email: 'marcus@example.com',
  points: 800,
  state: 'under_review',
  method: 'paypal',
  destination: 'marcus@example.com',
  daysAgo: 1,
})
await seedPayout({
  email: 'priya@example.com',
  points: 600,
  state: 'requested',
  method: 'upi',
  destination: 'priya@okhdfcbank',
  daysAgo: 0,
})
await seedPayout({
  email: 'marcus@example.com',
  points: 500,
  state: 'failed',
  method: 'paypal',
  destination: 'marcus.old@example.com',
  daysAgo: 6,
})

// --- support tickets --------------------------------------------------------

const [ticket] = await db
  .insert(tickets)
  .values({
    userId: userIds['priya@example.com']!,
    kind: 'missing_points',
    subject: 'Completed Temu order, no points',
    status: 'open',
    networkId: offerWall!.id,
    externalTransactionId: 'seed-tx-00099',
    claimedOfferName: 'Temu — first order',
    completedAt: daysAgo(2),
  })
  .returning({ id: tickets.id })

await db.insert(ticketMessages).values({
  ticketId: ticket!.id,
  authorUserId: userIds['priya@example.com']!,
  body: 'I placed an order for $8 two days ago and still have not received the points. Order number 55512.',
})

const [ticket2] = await db
  .insert(tickets)
  .values({
    userId: userIds['newbie@example.com']!,
    kind: 'payout_issue',
    subject: 'How long does PayPal take?',
    status: 'resolved',
  })
  .returning({ id: tickets.id })

await db.insert(ticketMessages).values([
  {
    ticketId: ticket2!.id,
    authorUserId: userIds['newbie@example.com']!,
    body: 'Requested a payout yesterday, when will it arrive?',
  },
  {
    ticketId: ticket2!.id,
    authorAdminId: adminId,
    body: 'PayPal payouts usually settle within one business day of approval.',
  },
])

// --- summary ----------------------------------------------------------------

const summary = (await db.execute(sql`
  SELECT u.email,
         b.posted_points::TEXT AS posted,
         b.withdrawable_points::TEXT AS withdrawable,
         b.on_hold_points::TEXT AS on_hold,
         b.pending_points::TEXT AS pending
  FROM users u JOIN user_balances b ON b.user_id = u.id
  ORDER BY b.posted_points DESC
`)) as unknown as Record<string, string>[]

console.log('\nseeded balances:')
console.table(summary)
console.log('\nsign in at http://localhost:3000 with any seeded email / password123')
console.log('admin at http://localhost:3000/admin with admin@example.com / admin12345\n')

process.exit(0)
