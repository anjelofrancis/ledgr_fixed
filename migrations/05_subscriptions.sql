-- ============================================
-- SUBSCRIPTIONS & PLANS
-- What each LEDGR customer (business) pays for, and what that unlocks.
-- ============================================

CREATE TABLE IF NOT EXISTS plans (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price_monthly DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'KES',
  features JSONB NOT NULL DEFAULT '[]',   -- feature flags, e.g. ["pos", "forecast"]
  limits JSONB NOT NULL DEFAULT '{}',     -- numeric caps; a missing key means unlimited
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_public BOOLEAN NOT NULL DEFAULT true
);

-- Matches the pricing on the landing page. Re-running keeps plans in sync with this file.
INSERT INTO plans (code, name, price_monthly, features, limits, sort_order) VALUES
  ('free',       'Free',       0,    '[]',                                                       '{"max_employees": 2}', 1),
  ('pro',        'Pro',        1500, '["pos", "automated_billing", "forecast"]',                 '{}',                   2),
  ('enterprise', 'Enterprise', 5000, '["pos", "automated_billing", "forecast", "api_access"]',   '{}',                   3)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, price_monthly = EXCLUDED.price_monthly, features = EXCLUDED.features,
  limits = EXCLUDED.limits, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  plan_code VARCHAR(30) NOT NULL REFERENCES plans(code),
  status VARCHAR(20) NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,   -- paid through; NULL = no end (e.g. free plan)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_updated_at_subscriptions ON subscriptions;
CREATE TRIGGER trg_updated_at_subscriptions BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Existing businesses start a 14-day Pro trial so nobody loses features on deploy.
INSERT INTO subscriptions (business_id, plan_code, status, trial_ends_at)
SELECT id, 'pro', 'trialing', NOW() + INTERVAL '14 days' FROM businesses
ON CONFLICT (business_id) DO NOTHING;
