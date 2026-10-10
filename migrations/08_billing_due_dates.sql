-- Tie each bill payment to the due date it pays, so a bill can't be queued twice for the same date.

ALTER TABLE billing_transactions ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE billing_transactions DROP CONSTRAINT IF EXISTS billing_transactions_status_check;
ALTER TABLE billing_transactions ADD CONSTRAINT billing_transactions_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));

-- Clean up the duplicates the hourly job used to create: keep the oldest pending row per schedule.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY schedule_id ORDER BY initiated_at, id) AS rn
  FROM billing_transactions
  WHERE status = 'pending' AND due_date IS NULL AND schedule_id IS NOT NULL
)
UPDATE billing_transactions t
SET status = 'cancelled', completed_at = NOW(), error_message = 'Duplicate created by the hourly billing job'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

-- Pending payments for stopped schedules will never be sent.
UPDATE billing_transactions t
SET status = 'cancelled', completed_at = NOW(), error_message = 'Bill schedule was stopped'
FROM billing_schedules s
WHERE t.schedule_id = s.id AND t.status = 'pending' AND s.is_active = false;

-- The surviving pending row pays the schedule's current due date.
UPDATE billing_transactions t
SET due_date = s.next_due_date
FROM billing_schedules s
WHERE t.schedule_id = s.id AND t.status = 'pending' AND t.due_date IS NULL;

-- At most one live payment per schedule and due date (failed and cancelled attempts don't count).
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_tx_schedule_due
  ON billing_transactions (schedule_id, due_date)
  WHERE status IN ('pending', 'processing', 'completed') AND due_date IS NOT NULL;
