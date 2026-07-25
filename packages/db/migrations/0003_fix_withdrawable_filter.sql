-- The hold window gates CREDITS, not debits.
--
-- `user_balances` computed `withdrawable` as `available_at <= now()` across
-- every posted row. That reads correctly and is wrong under concurrency:
-- inside a transaction `now()` is `transaction_timestamp()`, so a debit
-- written by a transaction that started microseconds later lands in a
-- concurrent reader's future and drops out of the sum entirely.
--
-- Measured before the fix: ten simultaneous 250-point payout requests against
-- a 1000-point balance let nine through and left the balance at -1250, with
-- the per-user advisory lock correctly held the whole time. The lock was
-- serialising the transactions perfectly; each one was simply computing the
-- wrong number.
--
-- `on_hold` gets the matching treatment so the identity still holds:
--   withdrawable + on_hold = posted

CREATE OR REPLACE VIEW user_balances AS
SELECT
  u.id AS user_id,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'posted'), 0)::BIGINT
    AS posted_points,
  COALESCE(SUM(le.amount_points) FILTER (
    WHERE le.status = 'posted'
      AND (le.amount_points < 0 OR le.available_at <= now())
  ), 0)::BIGINT
    AS withdrawable_points,
  COALESCE(SUM(le.amount_points) FILTER (
    WHERE le.status = 'posted'
      AND le.amount_points > 0
      AND le.available_at > now()
  ), 0)::BIGINT
    AS on_hold_points,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'pending'), 0)::BIGINT
    AS pending_points,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'posted' AND le.amount_points > 0), 0)::BIGINT
    AS lifetime_earned_points
FROM users u
LEFT JOIN ledger_entries le ON le.user_id = u.id
GROUP BY u.id;
