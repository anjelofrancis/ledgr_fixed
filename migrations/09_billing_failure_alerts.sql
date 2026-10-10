-- The due date for which the business was last told automatic payment gave up (alert once per due date).
ALTER TABLE billing_schedules ADD COLUMN IF NOT EXISTS failure_alerted_for DATE;
