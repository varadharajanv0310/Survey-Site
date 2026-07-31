# Rewards platform

> A get-paid-to rewards site where the product is the ledger, the fraud layer
> and the redemption pipeline — not the survey inventory.

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6)
![Next.js](https://img.shields.io/badge/Next.js-15-000000)
![Fastify](https://img.shields.io/badge/Fastify-5-000000)
![Postgres](https://img.shields.io/badge/Postgres-16-4169E1)
![Redis](https://img.shields.io/badge/Redis-7-DC382D)

![Statement](docs/screenshots/statement.png)

A GPT ("get-paid-to") rewards site. Users complete third-party surveys and
offers, earn points, and redeem them for cash or gift cards.

We do not author the inventory. Survey walls and offer walls supply it, they
pay us per completed action, and we pass a share to the user as points. The
product is the account system, the points economy, the fraud layer and the
redemption pipeline sitting on top of those feeds.

---

---

## The problem

Money arrives from someone else's system, on their schedule, and they can take it
back. A survey wall credits a completion by calling a postback URL. It may call
that URL four times for the same completion. It may call it with a reversal three
days later, or — because these are distributed systems written by other people —
send the reversal *before* the credit it reverses. Offer walls claw back 5–15% of
revenue after the fact, routinely.

So the hard part is not the survey wall. It is that a user's balance is the output
of an unreliable, adversarial, out-of-order event stream, and that balance is a
number the user will try to withdraw as cash. Get the arithmetic wrong in the
user's favour and the business absorbs it; get it wrong the other way and you are
a rewards site that does not pay, which is the only reputation that matters in
this category.

The obvious design — a `balance` column, incremented on credit and decremented on
payout — fails on every one of those cases. A retried postback double-credits. A
late reversal has nothing to reverse against. A concurrent payout request reads a
balance another request is already spending. And when a dispute arrives there is
no record of how the number got there.

The second problem is that fraud here has two very different costs. Fraud on the
earning side costs margin. Fraud on the payout side costs cash. A single threshold
for both is wrong in one direction or the other, and treating a flagged user as a
confirmed fraudster punishes the many real people who share an IP with a housemate.

---

## Features

| Capability | How it works |
|---|---|
| Append-only ledger | No balance column anywhere; balance is a query over an immutable log |
| Database-enforced immutability | Triggers reject deletes and edits to amounts, accounts and reversal lineage — not application convention |
| Idempotent ingestion | Every write carries a deterministically composed idempotency key, so retried postbacks are safe |
| Two balance flavours | `posted` is what the user sees, `withdrawable` is what they can cash out after the hold window |
| Clawback handling | A reversal cannot exceed the entry it offsets; over-clawback after cash-out floors at zero and reports `absorbedPoints` |
| Pluggable fraud checks | Run concurrently with per-check timeouts; an errored check reports `unavailable` and resolves via `fraud_fail_mode` |
| Payout state machine | Full transition audit; the ledger is debited at request time so a balance cannot be spent twice |
| Network adapters | One file per network implementing `NetworkAdapter`, with no database handle and no decisions |
| Adversarial simulator | ~34 hostile postbacks — duplicates, late reversals, out-of-order reversals, tampered signatures |

---

## Screenshots

### Statement — the ledger, surfaced

![Statement](docs/screenshots/statement.png)

27 entries for a seeded account: 20,887 points earned, 7,932 available, 6,077 still
clearing, and **-1,878 taken back**. Clawbacks get their own line rather than being
silently netted off, because a user who cannot see the reversal assumes the site
stole from them.

### Balance — posted versus withdrawable

![Wallet](docs/screenshots/wallet.png)

The two balance flavours made visible. 7,932 points can be cashed out now; 6,077
are inside the hold window because networks can still take those completions back.
The copy explains the wait rather than presenting it as a penalty.

### Earn

![Earn](docs/screenshots/earn.png)

Supply as the user sees it — daily streak bonus, plus survey and offer inventory
filtered to the user's country. The simulator drives this in local development.

### Cash out

![Cash out](docs/screenshots/cash-out.png)

Redemption against the withdrawable balance only, with the minimum lowered by
account level. `PAYOUT_PROVIDER=mock` here; no real rail is wired.

### Account

![You](docs/screenshots/you.png)

Levels shorten the clearing window and lower the cash-out minimum — the lever that
rewards tenure without paying more per completion.

---

---

## Architecture

```
survey wall / offer wall
        |  signed postback (retried, out-of-order, sometimes hostile)
        v
   api  (Fastify)  -- adapter verifies signature, translates payload
        |             adapters hold no db handle and decide nothing
        v
   audit row written FIRST --> BullMQ (Redis)
                                    |
                                    v
                             worker (BullMQ consumer)
                                    |
                          fraud checks (concurrent, per-check timeout)
                                    |  opinion only - never writes the ledger
                                    v
                             ledger (append-only, trigger-enforced)
                                    |
                         posted balance | withdrawable balance
                                    v
                             payout state machine --> PayoutProvider
                                    |
                                    v
                               web (Next.js)
```

Ingestion is a separate service from the frontend on purpose: the postback URL is
what we hand to networks, and it should not go down because the web app is
deploying. The audit row is written *before* the job is enqueued, so a queue
failure is visible rather than silent — a lesson the simulator taught the hard way.

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| API | Fastify | Raw request bytes are preserved end to end; reserialising JSON breaks HMAC signatures in a way that looks exactly like a wrong secret |
| Queue | BullMQ on Redis | Postback processing must survive a restart and retry independently of the request |
| Database | Postgres 16 | The ledger's guarantees are triggers and constraints, which is a database's job rather than an ORM's |
| ORM | Drizzle | SQL-first, so the migration enforcing immutability is readable SQL rather than generated |
| Web | Next.js 15 | User site and admin panel ship as one deployment |
| Language | TypeScript | The money types are the ones worth checking |
| Tests | Vitest | Runs against real Postgres, because the guarantees under test are database-level |

---

---

## Getting started

### Prerequisites

- Node.js 18 or later
- Docker, for Postgres and Redis

### Installation and running

```bash
docker compose up -d postgres redis
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
```

Then three processes:

```bash
npm run api
```

```bash
npm run worker
```

```bash
npm run web
```

- User site — http://localhost:3000, any seeded email with `password123`
- Admin — http://localhost:3000/admin, `admin@example.com` / `admin12345`

### Configuration


Copy `.env.example` to `.env`. Every third-party service is unset by default and
falls back to a local stub, so the whole stack runs with no external accounts.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgres://rewards:rewards@localhost:5433/rewards` | Postgres connection |
| `TEST_DATABASE_URL` | For tests | — | Must end in `_test`; the suite refuses to run otherwise |
| `REDIS_URL` | Yes | `redis://localhost:6380` | BullMQ queues and rate limiting |
| `SESSION_SECRET` | Yes | — | Signs session cookies |
| `USER_TOKEN_SECRET` | Yes | — | Signs the user token embedded in wall URLs; without it anyone can credit any account |
| `SIM_SURVEY_WALL_SECRET` | Yes | `sim-survey-secret` | Simulator survey-wall signing secret |
| `SIM_OFFER_WALL_SECRET` | Yes | `sim-offer-secret` | Simulator offer-wall signing secret |
| `PAYOUT_PROVIDER` | No | `mock` | Anything but `mock` throws rather than pretending |
| `RESEND_API_KEY` / `EMAIL_FROM` | No | — | Email delivery; unset writes to console. Setting one without the other fails loudly |
| `IPQS_API_KEY` | No | — | IPQualityScore fraud signal; unset reports `unavailable` |
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | No | — | minFraud signal; unset reports `unavailable` |
| `TREMENDOUS_API_KEY` | No | — | Gift-card rail, unused while `PAYOUT_PROVIDER=mock` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | No | — | PayPal Payouts rail, unused while `PAYOUT_PROVIDER=mock` |

Network secrets are referenced indirectly: the database stores the *name* of the
env var holding a network's secret (`networks.secret_ref`), never the secret
itself. Live credentials stay out of database backups, seed files and the admin UI.

### Exercising the pipeline


```bash
npm run simulate
```

Fires ~34 adversarial postbacks at the running API and asserts the outcome.
See "The simulator" below.

```bash
npm test
```

Ledger test suite. Needs Postgres up; it runs against the real database
because the guarantees under test are triggers and constraints.

---

## Design notes

The ledger, supply model, adapters, adversarial simulator, fraud layer and payout
state machine each involve a decision worth explaining. Those are written up in
[`docs/DESIGN.md`](docs/DESIGN.md) — including what the simulator caught that the
test suite did not.

## Project structure

```
apps/
  api/         Fastify. Postback ingestion, user API, admin API.
  worker/      BullMQ consumer. Completion processing, payouts, catalog sync.
  web/         Next.js. User site and admin panel.
  simulator/   Adversarial network simulator.
packages/
  core/        All business logic. Ledger, fraud, payouts, adapters, auth.
  db/          Drizzle schema, migrations, seed.
```

---

## Limitations — what is not built

Not stubbed either, so nothing reads as working when it isn't:

- **Real network credentials.** Adapters are written; only secrets are missing.
- **Real payout rails.** Interface is done; setting `PAYOUT_PROVIDER` to
  anything but `mock` throws rather than pretending.
- **Ledger concurrency hardening.** `LedgerService.reserveForPayout` reads the
  balance and writes the debit as two statements. Two concurrent requests can
  both pass the check. The race is documented at the one call site where it
  exists, and needs a dedicated pass with real concurrent-write tests before
  this touches real money.
- **Production fraud tuning.** Framework is real; thresholds are guesses.
- **KYC.** Nothing.
- **Deployment / CI.** Nothing.
- **Email and SMS.** Written to the console.
- **Proxy/VPN detection.** Reports `unavailable` rather than faking a verdict.

See [DECISIONS.md](DECISIONS.md) for the judgment calls, including the ones
still open.

---

## Roadmap

- Ledger concurrency hardening: make `reserveForPayout` a single atomic statement,
  with real concurrent-write tests, before this touches real money
- Wire one real payout rail end to end (a UPI aggregator or PayPal Payouts)
- Replace guessed fraud thresholds with values tuned against observed outcomes
- KYC for payouts above a threshold
- CI running the ledger suite and the adversarial simulator on every push
