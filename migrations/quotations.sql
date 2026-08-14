-- Migration for Quotations & Estimates Module

CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(200), -- In case customer_id is null (one-off client)
    customer_email VARCHAR(150),
    quote_number VARCHAR(50) NOT NULL,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    valid_until DATE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
    public_token VARCHAR(100) UNIQUE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, quote_number)
);

CREATE TABLE IF NOT EXISTS quotation_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL, -- Optional inventory link
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quotations_business_id ON quotations(business_id);
CREATE INDEX IF NOT EXISTS idx_quotations_public_token ON quotations(public_token);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS set_timestamp_quotations ON quotations;
CREATE TRIGGER set_timestamp_quotations
    BEFORE UPDATE ON quotations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
