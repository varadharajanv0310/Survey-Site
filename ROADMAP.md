# What's left

Written down so it survives between sessions. Ordered by what I'd do next, not
by size.

---

## 1. Ledger concurrency hardening — its own session, before real money

`LedgerService.reserveForPayout` reads the balance and writes the debit as two
statements. Two concurrent payout requests can both pass the check and both
insert. The idempotency key does **not** help: two genuine requests have two
different payout ids and therefore two different keys.

The race lives at exactly one call site, deliberately, and is documented there.
Fixing it means a `SELECT … FOR UPDATE` on a per-user lock row or a
serializable transaction with a retry loop — plus tests that actually issue
concurrent writes rather than sequential ones.

**Nothing should touch a real payout rail until this is done.**

## 2. The "safe to be publicly reachable" bundle

One session. Also the thing that unblocks your partner, because networks will
not approve a publisher without it.

- **Rate limiting.** There is none, anywhere. Login, signup and password reset
  are all unthrottled.
- **Password reset and email verification pages.** The API works and sends the
  links; the frontend routes (`/reset`, `/verify`) do not exist, so every
  emailed link 404s.
- **Legal pages.** Privacy policy and terms. A hard requirement for network
  applications, so it sits on the critical path despite being boring.
- **Email delivery.** Currently console-logged. Needs a Resend (or similar)
  account, then roughly an hour of work.

## 3. The support loop

- **Admin ticket detail and reply UI.** The API is complete and the list view
  exists, but an admin cannot open a ticket or answer it.
- **Offer click tracking.** We record completions, not clicks. Without it,
  "I clicked the offer and got nothing" is unanswerable — and it is one of the
  most common tickets in this category.

## 4. Fraud layer completion

- **Device fingerprinting.** The column, the check and the plumbing all exist;
  nothing in the browser populates the field, so `duplicate_device` currently
  never fires. Needs FingerprintJS (open source) wired into signup and login.
- **Proxy/VPN detection.** Reports `unavailable` by design. Becomes an HTTP
  call once there is an IPQualityScore or MaxMind account.
- **Threshold tuning.** The framework is real; every number in it is a guess
  until there is traffic to tune against.

## 5. Test coverage beyond the ledger

The ledger has 23 tests and the pipeline has 12 simulator checks. The fraud
pipeline and the payout state machine have no unit tests — they are exercised
end to end but not in isolation.

## 6. Performance, when it matters (not yet)

Balance is `SUM` over a user's entries on every read. Fine now, will not hold
forever. The fix is a checkpoint table (balance as of entry N, sum forward),
which keeps the ledger authoritative rather than adding a mutable column. The
schema already accommodates it.

Also: `postback_events` grows without bound. Needs a retention policy.

---

## Blocked on the partner, not on code

Network accounts and credentials · UPI payout provider account · business
entity and bank account · domain · fraud signal provider · email provider.

Note the dependency runs backwards from how it feels: several of these
**require** a live site with legal pages and a working postback endpoint before
anyone will approve you. Building is what unblocks the accounts, not the
reverse.

## Deliberately untouched

Deployment, CI/CD, monitoring, backups, KYC.

---

## Housekeeping

- The GitHub repo is **public**. Worth making private before it gets sent to
  networks.
- Seed ledger entries all carry `created_at = now()`, so transaction history
  in the demo looks like everything happened at once. Cosmetic, seed-only.
