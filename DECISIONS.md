# Decisions

Running log of judgment calls made while building, so none of them stay buried
in a diff. Split into ones already answered, and ones waiting on you.

---

## Answered

| # | Decision | Answer |
|---|----------|--------|
| 1 | Migration tool | **Drizzle.** SQL-first migrations we own and edit, which the ledger's triggers, partial indexes and future row locks all need. |
| 2 | Append-only interpretation | **Forward-only `status`, everything else frozen by trigger.** Amounts and reversal lineage are immutable; a held credit still has to resolve to posted/rejected. |
| 3 | Clawback after cash-out | **Floor at zero.** `allow_negative_balance = false`. We absorb the loss rather than showing a user a negative balance. |
| 4 | Sessions | **Opaque server-side tokens**, not JWTs. A banned account has to lose access instantly. |
| 5 | Admin accounts | **Separate table** from `users`, so an admin compromise is not a user compromise. |
| 6 | Money units | **Integer USD micros** internally, minor units at the payout boundary. No floats anywhere. |
| 7 | Network secrets | **Env vars, referenced by name** from `networks.secret_ref`. Never in the database. |

---

## Waiting on you

These are the ones I've defaulted so I could keep building. Each note says what
I picked and what changing it would cost.

### 1. Payout rail

Aggregator (Tremendous / Tango Card — one integration, one approval, covers
PayPal + hundreds of gift cards) versus direct PayPal Payouts + an Indian PSP
for UPI (better margin, more integrations, slower approval).

*Default: `MockPayoutProvider` only. Costs nothing to defer — the interface
takes either. This is your partner's call and it gates nothing on my side.*

### 2. Primary geography

India-first changes payout methods (UPI, Paytm), display currency, and which
networks are worth approaching first. US/EU-first is a different network set
and a different payout mix.

*Default: USD, multi-currency already in the schema. Changing later is a
settings change plus a payout adapter, not a migration.*

### 3. Fraud fail mode

When a check errors or a signal provider is down: `open` credits everything
and lets fraud through during an outage; `closed` sends everything to review
and floods the queue when a check has a bug.

*Default: `closed`. Safer with real money, but it means a bug in one check
stalls all credits until someone notices.*

### 4. Revenue share

Currently 35% to us / 65% to the user, applied to every network. Real numbers
vary per network — survey walls typically give the user more than offer walls.

*Default: 3500 bps globally, overridable per network in the admin UI.*

### 5. Hold window length

72h for offer walls, 24h for survey walls before points become withdrawable.
Longer means fewer losses to late clawbacks; shorter means happier users.

*Default: 72h / 24h. Pure settings change.*

### 6. Minimum redemption

Currently 500 points ($0.50 at 1000 points/$1). Low minimums attract fraud and
raise per-payout fees; high minimums lose users who never reach them.

*Default: 500 points.*

### 7. Referral economics

500 point one-off bonus (paid when the referee first earns, not at signup) plus
10% lifetime commission on referee earnings, paid by us out of margin.

*Default: as above. The "paid on first earn, not signup" part matters — paying
at signup is free money for anyone with a disposable email address.*

### 8. Points display rate

1000 points = $1.00. Purely cosmetic but hard to change after launch, because
users anchor on the numbers they've seen.

*Default: 1000/$1.*
