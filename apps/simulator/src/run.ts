/**
 * Fires the adversarial scenarios at a running API and reports what happened.
 *
 * This is the closest thing we have to integration testing against a real
 * network, and it exists because the happy path is the least interesting part
 * of postback handling. Run it against a seeded database with the API and
 * worker up.
 */
import { sql } from 'drizzle-orm'
import { createDb } from '@app/db'
import { buildScenarios, signUserToken, type SimulatedRequest } from '@app/core'

const API = process.env.API_PUBLIC_URL ?? 'http://localhost:4000'
const db = createDb(process.env.DATABASE_URL ?? 'postgres://rewards:rewards@localhost:5433/rewards')
const SECRET = process.env.USER_TOKEN_SECRET ?? 'dev-only-change-me-usertoken'

const userRows = (await db.execute(sql`
  SELECT id::TEXT AS id, email FROM users WHERE status = 'active' ORDER BY created_at LIMIT 6
`)) as unknown as { id: string; email: string }[]

if (userRows.length === 0) {
  console.error('no users found. run `npm run db:seed` first.')
  process.exit(1)
}

const userTokens = userRows.map((u) => signUserToken(u.id, SECRET))

const scenarios = buildScenarios({
  offerWallSecret: process.env.SIM_OFFER_WALL_SECRET ?? 'sim-offer-secret',
  surveyWallSecret: process.env.SIM_SURVEY_WALL_SECRET ?? 'sim-survey-secret',
  userTokens,
  // Correct shape, wrong HMAC — someone editing sub_id in the wall URL.
  tamperedToken: `${userRows[0]!.id}.AAAAAAAAAAAAAAAAAAAAAAAAAAA`,
  // Correctly signed, but for an account that does not exist.
  orphanToken: signUserToken('00000000-0000-4000-8000-000000000000', SECRET),
})

/**
 * Build the query string by hand rather than with URLSearchParams.
 *
 * The survey-wall signature covers the raw query string, so parameter order
 * and encoding have to survive the trip byte for byte. URLSearchParams would
 * be free to reorder or re-encode, and the signature would fail — which is
 * exactly the failure mode this simulator exists to catch, so it must not be
 * introduced by the simulator itself.
 */
const toQueryString = (query: Record<string, string>) =>
  Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

const send = async (request: SimulatedRequest) => {
  const url = `${API}/postback/${request.networkKey}?${toQueryString(request.query)}`
  const started = Date.now()
  const response = await fetch(url)
  const body = (await response.json()) as { ok: boolean; accepted: boolean }
  return { status: response.status, accepted: body.accepted, ms: Date.now() - started }
}

console.log(`firing ${scenarios.length} scenarios at ${API}\n`)

const byScenario = new Map<string, { sent: number; accepted: number; rejected: number; maxMs: number }>()
let acceptedCount = 0
let httpErrors = 0

for (const request of scenarios) {
  if (request.delayMs) await new Promise((r) => setTimeout(r, request.delayMs))

  const result = await send(request)
  if (result.status >= 400) httpErrors += 1
  if (result.accepted) acceptedCount += 1
  const stat = byScenario.get(request.scenario) ?? { sent: 0, accepted: 0, rejected: 0, maxMs: 0 }
  stat.sent += 1
  if (result.accepted) stat.accepted += 1
  else stat.rejected += 1
  stat.maxMs = Math.max(stat.maxMs, result.ms)
  byScenario.set(request.scenario, stat)

  const marker = result.status >= 400 ? `HTTP ${result.status}` : result.accepted ? 'accepted' : 'refused '
  console.log(`  ${marker}  ${result.ms.toString().padStart(4)}ms  ${request.scenario} — ${request.description}`)
}

console.log('\nwaiting for the worker to drain...')
await new Promise((r) => setTimeout(r, 6000))

// --- what actually happened -------------------------------------------------

const summary = (await db.execute(sql`
  SELECT parse_status::TEXT AS parse_status,
         dedupe_outcome::TEXT AS dedupe_outcome,
         count(*)::TEXT AS n,
         max(handled_in_ms)::TEXT AS max_ms
  FROM postback_events
  WHERE received_at > now() - interval '5 minutes'
  GROUP BY parse_status, dedupe_outcome
  ORDER BY n DESC
`)) as unknown as Record<string, string>[]

const completionSummary = (await db.execute(sql`
  SELECT kind::TEXT AS kind, status::TEXT AS status, count(*)::TEXT AS n
  FROM completions
  WHERE received_at > now() - interval '5 minutes'
  GROUP BY kind, status
  ORDER BY n DESC
`)) as unknown as Record<string, string>[]

const dupes = (await db.execute(sql`
  SELECT external_transaction_id, kind::TEXT AS kind, count(*)::TEXT AS n
  FROM completions
  GROUP BY external_transaction_id, kind, reversal_event_id
  HAVING count(*) > 1
`)) as unknown as Record<string, string>[]

console.log('\npostback_events by outcome:')
console.table(summary)

console.log('completions created:')
console.table(completionSummary)

console.log('\nper-scenario request counts:')
console.table(
  [...byScenario.entries()].map(([scenario, s]) => ({
    scenario,
    sent: s.sent,
    accepted: s.accepted,
    refused: s.rejected,
    slowestMs: s.maxMs,
  })),
)

// --- the assertions that matter --------------------------------------------

let failures = 0
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

console.log('\nchecks:')

/**
 * Positive checks first, and deliberately so.
 *
 * An earlier version of this file only asserted that nothing bad happened —
 * no duplicates, no negative balances, no orphaned completions. Every one of
 * those passed while the queue was rejecting every single job and not one
 * credit was being written. Checks that can only fail when something goes
 * wrong will happily pass when nothing happens at all.
 */
/**
 * Ingestion only refuses what it can judge without touching the database: a
 * bad network signature or an unparseable payload. Whether the user token
 * resolves to a live account is decided in the worker, so those postbacks are
 * accepted here and dropped there — which is why `rejected_unknown_user` does
 * not count against this number.
 */
const expectedAccepted = scenarios.filter(
  (s) => s.expect !== 'rejected_signature' && s.expect !== 'rejected_malformed',
).length

check(
  'the API accepted every well-formed postback',
  acceptedCount === expectedAccepted,
  `${acceptedCount}/${expectedAccepted} accepted`,
)

const created = (await db.execute(sql`
  SELECT count(*)::TEXT AS n FROM completions WHERE received_at > now() - interval '5 minutes'
    AND external_transaction_id LIKE 'ow-%' OR external_transaction_id LIKE 'sw-%'
`)) as unknown as { n: string }[]
check(
  'the worker turned accepted postbacks into completions',
  Number(created[0]!.n) >= 20,
  `${created[0]!.n} completions from simulated traffic`,
)

const creditedPoints = (await db.execute(sql`
  SELECT COALESCE(SUM(amount_points), 0)::TEXT AS n FROM ledger_entries
  WHERE created_at > now() - interval '5 minutes' AND type IN ('earn','screenout')
`)) as unknown as { n: string }[]
check(
  'points were actually credited',
  Number(creditedPoints[0]!.n) > 0,
  `${creditedPoints[0]!.n} points`,
)

check('no duplicate completions were created', dupes.length === 0, `${dupes.length} duplicate groups`)

const badSig = summary.find((r) => r.parse_status === 'bad_signature')
check('badly signed postbacks were refused', Number(badSig?.n ?? 0) >= 2, `${badSig?.n ?? 0} refused`)

const malformed = summary.find((r) => r.parse_status === 'malformed')
check('malformed postbacks were refused', Number(malformed?.n ?? 0) >= 1, `${malformed?.n ?? 0} refused`)

check('no request returned a server error', httpErrors === 0, `${httpErrors} HTTP 4xx/5xx`)

const slowest = Math.max(...summary.map((r) => Number(r.max_ms ?? 0)))
check('ingestion stayed off the slow path', slowest < 250, `slowest handler ${slowest}ms`)

const tampered = (await db.execute(sql`
  SELECT count(*)::TEXT AS n FROM completions
  WHERE user_id IS NULL AND received_at > now() - interval '5 minutes'
`)) as unknown as { n: string }[]
check(
  'no completion was created for an unverifiable user token',
  Number(tampered[0]!.n) === 0,
  `${tampered[0]!.n} orphaned`,
)

const reversals = completionSummary.filter((r) => r.kind === 'reversal')
check('reversals were recorded', reversals.length > 0, `${reversals.map((r) => r.n).join(', ')}`)

const negative = (await db.execute(sql`
  SELECT count(*)::TEXT AS n FROM user_balances WHERE posted_points < 0
`)) as unknown as { n: string }[]
check('no balance went negative', Number(negative[0]!.n) === 0, `${negative[0]!.n} negative`)

/**
 * The out-of-order case: a reversal that arrived before the credit it
 * reverses. It is parked as `received` and picked up by the reconciliation
 * sweep once its credit lands. If any are still unreconciled after the sweep
 * has had a chance to run, the user is keeping points the network took back.
 */
const orphans = (await db.execute(sql`
  SELECT count(*)::TEXT AS n
  FROM completions c
  WHERE c.kind = 'reversal'
    AND c.status = 'received'
    AND EXISTS (
      SELECT 1 FROM ledger_entries le
      WHERE le.external_transaction_id = c.external_transaction_id
        AND le.type IN ('earn','screenout')
    )
`)) as unknown as { n: string }[]
check(
  'out-of-order reversals were reconciled once their credit arrived',
  Number(orphans[0]!.n) === 0,
  `${orphans[0]!.n} still unapplied`,
)

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
