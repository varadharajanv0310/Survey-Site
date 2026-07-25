# What's left

Written down so it survives between sessions.

---

## Done since this file was written

Items 1–5 of the previous roadmap are complete. Briefly:

- **Ledger concurrency** — per-user advisory lock around every read-then-write,
  plus a filter bug it uncovered where the hold window was gating debits. 7
  concurrency tests issuing genuinely simultaneous writes. See DECISIONS.md.
- **Rate limiting** — Redis-backed, tiered by what abuse costs: tight on
  credentials, generous on postbacks because networks legitimately burst.
- **Reset / verify / legal pages** — emailed links now resolve; privacy policy
  and terms drafted (marked as needing legal review).
- **Email** — provider interface with a Resend adapter; console fallback that
  says plainly nothing was delivered.
- **Admin ticket UI** — full thread, internal notes, status changes, and the
  raw postback evidence inline so a missing-points claim can be answered
  rather than guessed at.
- **Click tracking** — separates "never started" from "network never fired"
  from "we rejected it".
- **Device fingerprinting** — collected in the browser and persisted, so
  `duplicate_device` fires instead of being inert. Signup now runs the fraud
  pipeline at all, which it previously never did.
- **Tests** — 61 total across ledger, concurrency, fraud pipeline, payouts.

---

## Still outstanding

### Blocked on the partner, not on code

Network accounts and credentials · UPI payout provider account · business
entity and bank account · domain · fraud signal provider (IPQualityScore or
MaxMind) · email provider account.

Note the dependency runs backwards from how it feels: several of these
**require** a live site with legal pages and a working postback endpoint before
anyone will approve you. That part is now done, so this is genuinely the
partner's critical path.

### Code, in rough priority order

1. **Fill in the legal placeholders and get them reviewed.** Every
   `[SQUARE BRACKET]` in `/legal/privacy` and `/legal/terms` needs a real
   value, and the pages need a lawyer's eyes. They are accurate about what the
   system does; that is not the same as being legally sufficient.

2. **Fraud threshold tuning.** The framework is real and now actually fires.
   Every number in it is a guess until there is traffic to tune against. The
   data to tune with is already being recorded (`fraud_check_results` stores
   per-check scores and details).

3. **Admin UI for the click log.** The `/admin/users/:id/activity` endpoint
   exists and the ticket page surfaces recent clicks, but the user detail page
   does not yet show the click timeline.

4. **Payout retry path.** `failed` is deliberately non-terminal so a user can
   correct their UPI ID, but there is no UI for editing a destination and
   retrying — currently an admin has to cancel and the user re-requests.

5. **Postback event retention.** `postback_events` grows without bound. Needs a
   pruning job for old rows that already resulted in a credit.

6. **Balance checkpointing.** Balance is a `SUM` per read. Fine at this scale;
   the fix when it stops being fine is a checkpoint table, which keeps the
   ledger authoritative rather than adding a mutable column.

7. **Session cleanup.** Expired rows in `sessions` and `auth_tokens` are never
   deleted.

### Deliberately untouched

Deployment, CI/CD, monitoring, backups, KYC.

---

## Housekeeping

- The GitHub repo is **public**. Worth making private before it goes to
  networks.
- Docker Desktop on this machine intermittently fails to start with a stale
  `dockerInference` socket. Fix: kill Docker processes, rename
  `%LOCALAPPDATA%\Docker\run` to anything else, restart Docker. It recreates
  the directory.
- Seed ledger entries all carry `created_at = now()`, so demo transaction
  history looks like it happened in one instant. Cosmetic, seed-only.
- UI design directions are pending — `design/UI_BRIEF.md` is written and
  waiting to be run.
