-- ============================================
-- GENERAL LEDGER (double entry)
-- Every financial event posts a journal entry whose debits equal its credits.
-- Entries are append-only: mistakes are corrected with a reversing entry.
-- ============================================

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_system BOOLEAN NOT NULL DEFAULT false,   -- used by automatic postings; don't delete
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  description VARCHAR(500) NOT NULL,
  source_type VARCHAR(50),          -- e.g. income_record, expense
  source_id UUID,                   -- the record this entry was posted from
  reverses_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A source record posts once, and an entry can be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_source
  ON journal_entries(business_id, source_type, source_id) WHERE reverses_entry_id IS NULL AND source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_reversal
  ON journal_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_business_date ON journal_entries(business_id, entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  debit DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit DECIMAL(14,2) NOT NULL DEFAULT 0,
  memo VARCHAR(255),
  CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))   -- exactly one side
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);

-- Debits must equal credits for every entry, checked at commit time.
CREATE OR REPLACE FUNCTION check_journal_balanced() RETURNS TRIGGER AS $$
DECLARE
  diff DECIMAL(14,2);
  line_count INTEGER;
BEGIN
  SELECT COALESCE(SUM(debit) - SUM(credit), 0), COUNT(*) INTO diff, line_count
  FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF line_count < 2 OR diff <> 0 THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (lines: %, debit - credit: %)', NEW.entry_id, line_count, diff;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Posted entries are immutable. (DELETE is left to cascades from businesses; the app never deletes.)
CREATE OR REPLACE FUNCTION prevent_journal_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Journal entries cannot be changed; post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutable BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_change();
DROP TRIGGER IF EXISTS trg_journal_lines_immutable ON journal_lines;
CREATE TRIGGER trg_journal_lines_immutable BEFORE UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_change();
