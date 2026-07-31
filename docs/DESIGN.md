# Design notes

The parts of the rewards platform that carry the most weight, and why they are
built the way they are. Extracted from the README to keep the front page to a
readable length.

### The ledger

There is no balance column anywhere. Balance is a query over an append-only
log, and the rules are enforced by database triggers rather than convention —
[`0001_ledger_immutability.sql`](packages/db/migrations/0001_ledger_immutability.sql).

Rows cannot be deleted. Amounts, accounts and reversal lineage cannot be
edited. `status` is the single mutable field and moves forward only. A reversal
cannot exceed the entry it offsets, or target a debit. Every write carries a
unique idempotency key.

That last one is what makes retried postbacks safe. Networks retry hard, and
the key is composed deterministically rather than taken from the transaction id
alone, because networks reuse the transaction id when they claw back.

**Balance has two flavours.** `posted` is what the user sees; `withdrawable` is
what they can cash out. Offer walls reverse 5–15% of revenue days after
crediting it, so credits wait out a hold window while debits count immediately.

**Clawback after cash-out floors at zero.** If a network reverses more than the
user still has, we recover what we can and absorb the rest — reported as
`absorbedPoints`, not hidden.

### Supply

Survey walls and offer walls are different products and do not share a row
shape. Offer walls have a catalog API we sync into `offers`. Survey walls are
signed iframes whose own JS decides what to show — they are `wall_placements`,
and there is nothing to sync.

Screenouts are first-class. Users are disqualified from most survey attempts
and walls pay a few cents for it; a model that only understands "completed"
drops the majority of its events.

### Adapters

Each network is one file implementing `NetworkAdapter`. Adapters translate and
verify — they get no database handle and decide nothing. Adding a real network
is a new file plus a row in `networks`; no other code moves.

The two shipped adapters are modelled on real conventions: md5-over-query
signatures for the offer wall, HMAC-over-raw-query-string for the survey wall.
Raw request bytes are preserved end to end, because reserialising JSON breaks
signatures in a way that looks exactly like a wrong secret.

### The simulator

`npm run simulate` is the closest thing to integration testing against a real
network. It sends what an offer wall actually does on a bad day: the same
postback four times, a reversal three days late, a reversal arriving *before*
its credit, screenouts worth fractions of a cent, a missing amount, a wrong
secret, and a user token with a tampered signature.

It has already earned its keep. It caught that BullMQ rejects job ids
containing `:`, which meant every enqueue threw a 500 *after* the audit row was
written — the pipeline looked healthy and processed nothing. It also caught
that out-of-order reversals were parked and never applied, so a user kept
points the network had taken back.

It also taught a lesson about assertions: the first version's checks all passed
during that outage, because they only verified nothing *bad* happened and never
that credits actually landed.

### Fraud

Pluggable checks run concurrently with per-check timeouts. A check that errors
reports `unavailable` and resolves through `fraud_fail_mode` rather than
silently allowing. Nothing in the pipeline writes to the ledger or bans anyone
— it forms an opinion, the caller applies it.

A flagged credit is **held**, not rejected. Most flagged users are real people
on a shared IP, and quietly eating their points is how a rewards site earns a
reputation for not paying.

Fraud on the earning side costs margin. Fraud on the payout side costs cash, so
the payout gate is stricter. The strongest signal available is one payout
destination shared across accounts.

### Payouts

A state machine with a full transition audit, not a function call. The ledger
is debited at **request** time — otherwise a user with 1000 points submits three
1000-point requests before anyone looks at the first. Cancelling refunds with a
new positive entry; the debit is never deleted.

`PayoutProvider.send()` may return `processing`. PayPal Payouts and every UPI
aggregator settle asynchronously, and an interface shaped as success-or-throw
would need rewriting on the first real rail.

Only `MockPayoutProvider` exists. It does not move money, and it deliberately
fails a share of sends, because code that has only seen success handles none of
the real cases.

---

See [DECISIONS.md](../DECISIONS.md) for the judgment calls, including the ones
still open.
