const { query } = require('../../config/database');

const DEBIT_NORMAL = ['asset', 'expense'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));

// GET /statements/ledger — trial balance and recent journal entries
const showLedger = async (req, res) => {
  const businessId = req.user.business_id;
  const today = new Date().toISOString().split('T')[0];
  const from = isDate(req.query.from) ? req.query.from : `${today.slice(0, 4)}-01-01`;
  const to = isDate(req.query.to) ? req.query.to : today;

  try {
    const [accounts, entries] = await Promise.all([
      query(
        `SELECT a.code, a.name, a.type,
                COALESCE(SUM(l.debit), 0)::float AS debit,
                COALESCE(SUM(l.credit), 0)::float AS credit
         FROM accounts a
         LEFT JOIN journal_lines l ON l.account_id = a.id
           AND l.entry_id IN (SELECT id FROM journal_entries WHERE business_id = $1 AND entry_date BETWEEN $2 AND $3)
         WHERE a.business_id = $1
         GROUP BY a.id ORDER BY a.code`,
        [businessId, from, to]
      ),
      query(
        `SELECT e.id, e.entry_date, e.description, e.reverses_entry_id,
                json_agg(json_build_object('code', a.code, 'name', a.name, 'debit', l.debit, 'credit', l.credit) ORDER BY l.debit DESC) AS lines
         FROM journal_entries e
         JOIN journal_lines l ON l.entry_id = e.id
         JOIN accounts a ON a.id = l.account_id
         WHERE e.business_id = $1 AND e.entry_date BETWEEN $2 AND $3
         GROUP BY e.id ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 30`,
        [businessId, from, to]
      ),
    ]);

    // Balance on the account's normal side; positive = normal
    const rows = accounts.rows.map(a => ({
      ...a,
      balance: DEBIT_NORMAL.includes(a.type) ? a.debit - a.credit : a.credit - a.debit,
    }));
    const totals = rows.reduce((t, a) => ({ debit: t.debit + a.debit, credit: t.credit + a.credit }), { debit: 0, credit: 0 });
    const sumType = (type) => rows.filter(a => a.type === type).reduce((s, a) => s + a.balance, 0);

    res.render('pages/statements/ledger', {
      title: 'General Ledger — LEDGR',
      accounts: rows,
      entries: entries.rows,
      totals,
      balanced: Math.abs(totals.debit - totals.credit) < 0.005,
      netProfit: sumType('income') - sumType('expense'),
      filters: { from, to },
    });
  } catch (err) {
    console.error('Ledger error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load the ledger.', code: 500 });
  }
};

module.exports = { showLedger };
