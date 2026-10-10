-- Financial records are voided, never deleted: the row stays for the audit trail
-- and is excluded from totals and reports.
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Reports filter on "voided_at IS NULL"; keep the common lookups fast.
CREATE INDEX IF NOT EXISTS idx_income_active ON income_records(business_id, date) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_active ON expenses(business_id, date) WHERE voided_at IS NULL;
