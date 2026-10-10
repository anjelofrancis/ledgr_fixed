-- Default chart of accounts. Automatic postings (src/utils/ledger.js) refer to these codes.
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(biz UUID) RETURNS VOID AS $$
BEGIN
  INSERT INTO accounts (business_id, code, name, type, is_system) VALUES
    (biz, '1000', 'Cash on hand',             'asset',     true),
    (biz, '1010', 'M-Pesa',                   'asset',     true),
    (biz, '1020', 'Bank',                     'asset',     true),
    (biz, '1030', 'Card settlements',         'asset',     true),
    (biz, '2000', 'Accounts payable',         'liability', true),
    (biz, '3000', 'Owner''s equity',          'equity',    true),
    (biz, '4000', 'Sales revenue',            'income',    true),
    (biz, '4100', 'Other income',             'income',    true),
    (biz, '6100', 'Utilities',                'expense',   true),
    (biz, '6200', 'Repairs & maintenance',    'expense',   true),
    (biz, '6300', 'Supplier purchases',       'expense',   true),
    (biz, '6400', 'Salaries & wages',         'expense',   true),
    (biz, '6500', 'Taxes & licences',         'expense',   true),
    (biz, '6900', 'Other expenses',           'expense',   true)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT seed_chart_of_accounts(id) FROM businesses;
