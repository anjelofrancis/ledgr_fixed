-- Migration for Inventory & Stock Management

CREATE TABLE IF NOT EXISTS inventory_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    category_id UUID REFERENCES inventory_categories(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(100),
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    cost_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    sell_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'KES',
    reorder_level INTEGER NOT NULL DEFAULT 5,
    supplier VARCHAR(200),
    location VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    recorded_by UUID REFERENCES users(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('restock', 'sale', 'adjustment', 'damage', 'return')),
    quantity_change INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    reference VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_items_business_id ON inventory_items(business_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item_id ON inventory_transactions(item_id);

DROP TRIGGER IF EXISTS set_timestamp_inventory_items ON inventory_items;
CREATE TRIGGER set_timestamp_inventory_items
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Note: Default categories are auto-created when a business first visits the inventory page (handled in the controller).
