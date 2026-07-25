-- Ledger integrity rules that live in the database rather than in application
-- code, because "the ledger is append-only" is worth exactly as much as the
-- weakest caller if it is only a convention.
--
-- Any future admin script, migration, psql session or generated repair job is
-- subject to these. That is the point.

-- ---------------------------------------------------------------------------
-- 1. Rows are never deleted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_entries_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries rows cannot be deleted (attempted on id=%). Write an offsetting reversal instead.',
    OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER ledger_entries_no_delete_trg
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_no_delete();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The financial facts of a row never change. `status` is the single
--    mutable field, and it only moves forward.
--
--    This is the deliberate exception to strict append-only: a credit held for
--    fraud review has to resolve to posted or rejected. What matters -- the
--    amount, the account, the reversal lineage -- stays frozen.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_entries_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.amount_points IS DISTINCT FROM OLD.amount_points
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.reverses_entry_id IS DISTINCT FROM OLD.reverses_entry_id
     OR NEW.completion_id IS DISTINCT FROM OLD.completion_id
     OR NEW.config_version IS DISTINCT FROM OLD.config_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'ledger_entries id=% is immutable: cannot change user_id, amount_points, type, idempotency_key, reverses_entry_id, completion_id, config_version or created_at',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'pending' AND NEW.status IN ('posted', 'rejected'))
      OR (OLD.status = 'posted'  AND NEW.status = 'void')
    ) THEN
      RAISE EXCEPTION
        'illegal ledger_entries status transition on id=%: % -> %',
        OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;

    NEW.status_changed_at := now();
    IF NEW.status = 'posted' AND NEW.posted_at IS NULL THEN
      NEW.posted_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER ledger_entries_immutable_trg
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A reversal may not exceed what it offsets, and may only offset a
--    positive entry.
--
--    A reversal written with the wrong sign or an inflated amount pays the
--    user *more* for fraud than the original completion did. Checked on write
--    rather than trusted to the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_entries_validate_reversal()
RETURNS TRIGGER AS $$
DECLARE
  original_amount BIGINT;
  already_reversed BIGINT;
BEGIN
  IF NEW.type <> 'reversal' THEN
    RETURN NEW;
  END IF;

  SELECT amount_points INTO original_amount
    FROM ledger_entries WHERE id = NEW.reverses_entry_id;

  IF original_amount IS NULL THEN
    RAISE EXCEPTION 'reversal target % does not exist', NEW.reverses_entry_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF original_amount <= 0 THEN
    RAISE EXCEPTION
      'cannot reverse a non-positive entry (id=%, amount=%)',
      NEW.reverses_entry_id, original_amount
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT COALESCE(SUM(-amount_points), 0) INTO already_reversed
    FROM ledger_entries
   WHERE reverses_entry_id = NEW.reverses_entry_id
     AND type = 'reversal'
     AND status <> 'rejected';

  IF already_reversed + (-NEW.amount_points) > original_amount THEN
    RAISE EXCEPTION
      'over-reversal of entry %: original=%, already reversed=%, attempted=%',
      NEW.reverses_entry_id, original_amount, already_reversed, -NEW.amount_points
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER ledger_entries_validate_reversal_trg
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_validate_reversal();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Balance as a view, so no caller has to remember the two-flavour rule.
--
--    `withdrawable` counts debits immediately but makes credits wait out their
--    hold window -- the conservative direction.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW user_balances AS
SELECT
  u.id AS user_id,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'posted'), 0)::BIGINT
    AS posted_points,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'posted' AND le.available_at <= now()), 0)::BIGINT
    AS withdrawable_points,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'posted' AND le.available_at > now()), 0)::BIGINT
    AS on_hold_points,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'pending'), 0)::BIGINT
    AS pending_points,
  COALESCE(SUM(le.amount_points) FILTER (WHERE le.status = 'posted' AND le.amount_points > 0), 0)::BIGINT
    AS lifetime_earned_points
FROM users u
LEFT JOIN ledger_entries le ON le.user_id = u.id
GROUP BY u.id;
