# Decisions

Running log of judgment calls made while building, so none of them stay buried
in a diff. Split into ones already answered, and ones waiting on you.

---

## Answered

| # | Decision | Answer |
|---|----------|--------|
| 1 | Migration tool | **Drizzle.** SQL-first migrations we own and edit, which the ledger's triggers, partial indexes and future row locks all need. |
| 2 | Append-only interpretation | **Forward-only `status`, everything else frozen by trigger.** Amounts and reversal lineage are immutable; a held credit still has to resolve to posted/rejected. |
| 3 | Clawback after cash-out | **Floor at zero.** `allow_negative_balance = false`. We absorb the loss rather than showing a user a negative balance, and the absorbed amount is reported rather than hidden. |
| 4 | Sessions | **Opaque server-side tokens**, not JWTs. A banned account has to lose access instantly. |
| 5 | Admin accounts | **Separate table** from `users`, so an admin compromise is not a user compromise. |
| 6 | Money units | **Integers throughout.** USD micros at ingestion (networks quote fractions of a cent), base-currency micros in between, minor units at the payout boundary. No float touches money at any layer. |
| 7 | Network secrets | **Env vars, referenced by name** from `networks.secret_ref`. Never in the database. |
| 8 | Password hashing | **scrypt from node's stdlib**, not argon2id. argon2 is the better algorithm and the OWASP first choice; scrypt is the accepted second. The trade buys zero native dependencies, which matters developing on Windows and deploying on Linux. Stored hashes are prefixed so both can coexist if we switch. |
| 9 | Time authority | **The database clock, always.** Hold windows are computed as `now() + interval` server-side. Taking `new Date()` in the app and comparing it to `now()` in a query compares two machines' clocks — locally that drift was already 300ms, enough that freshly credited points were briefly not withdrawable. |
| 10 | Queue job ids | **Hashed, not concatenated.** BullMQ rejects ids containing `:`, and network transaction ids are arbitrary strings we do not control. |
| 11 | Held vs rejected credits | A flagged credit is **held pending review**, never silently dropped. Most flags are real users on shared infrastructure. |
| 12 | Admin sessions | **Database-backed** with a 12-hour TTL, in their own table. An in-memory map would drop every admin session on restart and could not work across processes. |
| 13 | Primary geography | **India first.** Users default to `IN`, the simulated catalog is Indian inventory at Indian payout levels, UPI is the first payout method. |
| 14 | Currency and rate | **INR, 10 points = ₹1.** Base currency, points-per-unit, minor units and the USD→INR rate are all settings; nothing is a literal. |
| 15 | Minimum redemption | **₹500 = 5,000 points.** |
| 16 | Referral | **Unchanged** — 500 points on the referee's first earning, plus 10% lifetime commission. See the note below. |
| 17 | Test database isolation | **Tests get their own database** and refuse to run against one whose name does not end in `_test`. `npm test` truncates everything it touches, and it had already wiped a freshly seeded dev database once. |

---

## Three things the India switch made true

### The FX exposure

Networks pay us in **USD**. We now owe users in **INR**. That gap is real
exposure, and it is why `usd_to_base_rate` is a first-class setting rather than
a constant buried in a conversion function.

If the dollar weakens against the rupee, our revenue buys fewer rupees while
the points we already promised stay fixed, and margin shrinks with no code
change and no alert. The default is deliberately **below spot** (₹85) so the
error runs in our favour. Worth your partner knowing that network payment terms
are usually net-30 or net-60, so we carry that rate risk for a month or two on
every completion before the money actually arrives.

Changing the rate never re-prices history — every ledger entry stores the
config version it was written under.

### Keeping the referral bonus unchanged made it weaker

500 points used to be $0.50 against a $0.50 minimum cash-out: a referral paid
for a full withdrawal. It is now ₹50 against a ₹500 minimum, so it covers a
tenth of one. The number is identical; the incentive is materially smaller.
Worth revisiting once you see real referral behaviour.

### Indian offer economics are thinner

Indian traffic monetises at a fraction of US traffic for the same offer types —
advertisers bid far less per install and per signup. The simulated catalog
reflects that: gross-per-completion is roughly a fifth of the US figures it
replaced. The rupee amounts users see still read well, but margin per
completion is thinner, so volume and fraud control matter more than they would
in a US-first build.

---

## Waiting on you

Defaulted so I could keep building. Each note says what I picked and what
changing it costs.

### 1. Payout rail

For India this is really: which UPI aggregator (Cashfree, RazorpayX, Paytm
Payouts) versus a multi-rail aggregator that also covers gift cards. UPI is
cheap per transfer and instant, which suits a ₹500 minimum; gift cards avoid
banking-partner scrutiny but are less attractive to users.

*Default: `MockPayoutProvider` only. The interface takes any of them, and
`send()` already returns `processing` because UPI settles asynchronously. Your
partner's call; gates nothing on my side.*

### 2. Fraud fail mode

When a check errors or a signal provider is down: `open` credits everything and
lets fraud through during an outage; `closed` sends everything to review and
floods the queue when a check has a bug.

*Default: `closed`. Safer with real money, but a bug in one check stalls all
credits until someone notices.*

### 3. Revenue share

35% to us / 65% to the user, applied to every network. Real numbers vary per
network — survey walls typically give the user more than offer walls, and
Indian offer walls often run tighter than US ones.

*Default: 3500 bps globally, overridable per network in the admin UI.*

### 4. Hold window length

72h for offer walls, 24h for survey walls before points become withdrawable.
Longer means fewer losses to late clawbacks; shorter means happier users. On a
₹500 minimum, a user earning ₹50 a day is waiting a fortnight to cash out
anyway, so the hold may matter less here than it would with a low minimum.

*Default: 72h / 24h. Pure settings change.*
