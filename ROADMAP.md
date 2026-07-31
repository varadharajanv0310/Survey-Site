# What's left

Written down so it survives between sessions. Current as of commit `1a1a7a1`.

---

## Where the project stands

The **product is feature-complete** for a first launch. A user can sign up,
earn from offers and surveys, watch points clear, cash out, refer someone, and
raise a support ticket. An admin can review fraud, approve payouts, answer
tickets, tune settings, and see per-network margin. The ledger's guarantees are
enforced by the database and tested under real concurrency.

What is left is mostly **launch readiness and judgement calls**, not features.

Built and verified: 69 tests, 12/12 adversarial simulator checks, 25 routes,
two complete visual directions at mobile and desktop.

---

## 1. The decision that gates the rest

**Pick a direction — Tally or Tempo.** Both are built and switchable, but
maintaining two indefinitely doubles the cost of every future screen. Once you
choose, the loser gets deleted and the winner gets the polish below.

Everything else in this file is smaller than it looks. This isn't.

---

## 2. Code, not blocked on anyone

Roughly in the order I'd do them.

1. **Fill in the legal placeholders and get them reviewed.** Every
   `[SQUARE BRACKET]` in `/legal/privacy` and `/legal/terms` needs a real
   value. They are accurate about what the system does; that is not the same as
   legally sufficient. **This is on your partner's critical path** — networks
   will not approve a publisher without them.

2. **Two rough edges visible in the built UI:**
   - Tempo's pace target is derived from a monthly average, so an unusually
     good week reads as "14,738 of 6,000". Honest but odd-looking; needs a
     longer baseline or a display cap.
   - Tally's month chart has no minimum bar height, so quiet days vanish next
     to a big one.

3. **Visual QA of the screens I only checked structurally.** I verified
   contrast, overflow and layout switching programmatically across both
   themes, but only *looked* at the balance screen. Earn, cash out, statement,
   refer, support, and the auth screens deserve eyes at 360px.

4. **The admin surface was not redesigned.** It compiles and picks up whichever
   theme is active, but it was drawn for the old palette and never art-directed
   for either direction. It is Operate mode and can stay plainer than the user
   app, but it should be deliberate rather than inherited.

5. **Payout retry path.** `failed` is deliberately non-terminal so a user can
   correct their UPI ID, but there is no UI for editing a destination and
   retrying — an admin has to cancel and the user re-requests.

6. **Admin click timeline on the user detail page.** The
   `/admin/users/:id/activity` endpoint exists and the ticket page shows recent
   clicks; the user detail page does not.

7. **Fraud threshold tuning.** The framework is real and now actually fires.
   Every number in it is a guess until there is traffic. The data to tune with
   is already being recorded in `fraud_check_results`.

8. **Housekeeping jobs.** `postback_events` grows without bound and needs
   pruning. Expired rows in `sessions` and `auth_tokens` are never deleted.

9. **Balance checkpointing.** Balance is a `SUM` per read. Fine at this scale;
   the fix when it stops being fine is a checkpoint table, which keeps the
   ledger authoritative rather than adding a mutable column.

---

## 3. Blocked on the partner, not on code

Network accounts and credentials · UPI payout provider account · business
entity and bank account · domain · fraud signal provider (IPQualityScore or
MaxMind) · email provider account.

The dependency runs backwards from how it feels: several of these **require** a
live site with legal pages and a working postback endpoint before anyone will
approve you. That part is done, so this is genuinely the partner's critical
path now — apart from filling in the legal placeholders.

---

## 4. Deliberately untouched

Deployment, CI/CD, monitoring, backups, KYC.

---

## Housekeeping

- The GitHub repo is **public**. Worth making private before it goes to
  networks.
- Docker Desktop on this machine intermittently fails to start with a stale
  `dockerInference` socket. Fix: kill Docker processes, rename
  `%LOCALAPPDATA%\Docker\run` to anything else, restart Docker.
- Agent skills and their lockfile are gitignored — they are local tooling, not
  part of the product. Restore a set with `npx skills experimental_install`.
