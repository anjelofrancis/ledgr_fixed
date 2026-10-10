// ============================================
// LEDGER POSTING
// Turns business events into balanced double-entry journal entries.
// Always call inside a transaction (pass the pg client) so the entry commits
// atomically with the record it came from.
// ============================================

// Account codes from the default chart of accounts (migrations/07_chart_of_accounts.sql)
const ACCOUNTS = {
  cash: '1000', mpesa: '1010', bank: '1020', card: '1030',
  payables: '2000',
  sales: '4000', otherIncome: '4100',
  utilities: '6100', maintenance: '6200', supplies: '6300', payroll: '6400', taxes: '6500', otherExpense: '6900',
};

// Where money lands / leaves from, by payment method
const PAYMENT_ACCOUNT = {
  cash: ACCOUNTS.cash, mpesa: ACCOUNTS.mpesa, card: ACCOUNTS.card,
  bank_transfer: ACCOUNTS.bank, bank: ACCOUNTS.bank, cheque: ACCOUNTS.bank,
};

const EXPENSE_ACCOUNT = {
  utility: ACCOUNTS.utilities, maintenance: ACCOUNTS.maintenance, supplier: ACCOUNTS.supplies,
  payroll: ACCOUNTS.payroll, tax: ACCOUNTS.taxes, other: ACCOUNTS.otherExpense,
};

const SALES_SOURCES = ['daily_sales', 'invoice', 'pos'];
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Post a journal entry. lines: [{ account: '1000', debit: 100 } | { account: '4000', credit: 100 }]
 * Throws if the lines don't balance or an account code is missing.
 * Returns the entry id, or null if this source record was already posted.
 */
const postEntry = async (client, { businessId, date, description, sourceType = null, sourceId = null, userId = null, lines }) => {
  const clean = lines
    .map(l => ({ account: l.account, debit: round2(l.debit || 0), credit: round2(l.credit || 0), memo: l.memo || null }))
    .filter(l => l.debit > 0 || l.credit > 0);
  const debits = round2(clean.reduce((s, l) => s + l.debit, 0));
  const credits = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (clean.length < 2 || debits !== credits) {
    throw new Error(`Unbalanced journal entry "${description}": debits ${debits} vs credits ${credits}`);
  }

  const codes = [...new Set(clean.map(l => l.account))];
  const accounts = await client.query(
    'SELECT id, code FROM accounts WHERE business_id = $1 AND code = ANY($2)', [businessId, codes]
  );
  const idByCode = Object.fromEntries(accounts.rows.map(a => [a.code, a.id]));
  const missing = codes.filter(c => !idByCode[c]);
  if (missing.length) throw new Error(`Ledger accounts missing for business: ${missing.join(', ')}`);

  const entry = await client.query(
    `INSERT INTO journal_entries (business_id, entry_date, description, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (business_id, source_type, source_id) WHERE reverses_entry_id IS NULL AND source_id IS NOT NULL
     DO NOTHING RETURNING id`,
    [businessId, date, description.slice(0, 500), sourceType, sourceId, userId]
  );
  if (!entry.rows.length) return null; // already posted
  const entryId = entry.rows[0].id;

  for (const l of clean) {
    await client.query(
      'INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo) VALUES ($1, $2, $3, $4, $5)',
      [entryId, idByCode[l.account], l.debit, l.credit, l.memo]
    );
  }
  return entryId;
};

/**
 * Reverse the entry posted for a source record (e.g. when it is voided).
 * Returns the reversal entry id, or null if nothing was posted or it was already reversed.
 */
const reverseSource = async (client, { businessId, sourceType, sourceId, date, reason, userId = null }) => {
  const original = await client.query(
    `SELECT e.id, e.description FROM journal_entries e
     WHERE e.business_id = $1 AND e.source_type = $2 AND e.source_id = $3 AND e.reverses_entry_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = e.id)`,
    [businessId, sourceType, sourceId]
  );
  if (!original.rows.length) return null;
  const { id: originalId, description } = original.rows[0];

  const reversal = await client.query(
    `INSERT INTO journal_entries (business_id, entry_date, description, source_type, source_id, reverses_entry_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [businessId, date, `Reversal: ${description}${reason ? ` (${reason})` : ''}`.slice(0, 500), sourceType, sourceId, originalId, userId]
  );
  // Swap each line's debit and credit
  await client.query(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo)
     SELECT $1, account_id, credit, debit, memo FROM journal_lines WHERE entry_id = $2`,
    [reversal.rows[0].id, originalId]
  );
  return reversal.rows[0].id;
};

// Income received: Dr cash/M-Pesa/bank/card, Cr sales (or other income)
const postIncome = (client, income, userId = null) =>
  postEntry(client, {
    businessId: income.business_id,
    date: income.date,
    description: income.description || `Income: ${income.source || 'sales'}`,
    sourceType: 'income_record',
    sourceId: income.id,
    userId,
    lines: [
      { account: PAYMENT_ACCOUNT[income.payment_mode] || ACCOUNTS.cash, debit: income.amount },
      { account: SALES_SOURCES.includes(income.source) ? ACCOUNTS.sales : ACCOUNTS.otherIncome, credit: income.amount },
    ],
  });

// Expense: Dr expense account by category type; Cr the payment account, or payables if unpaid
const postExpense = (client, expense, categoryType, userId = null) =>
  postEntry(client, {
    businessId: expense.business_id,
    date: expense.date,
    description: `Expense: ${expense.description}`,
    sourceType: 'expense',
    sourceId: expense.id,
    userId,
    lines: [
      { account: EXPENSE_ACCOUNT[categoryType] || ACCOUNTS.otherExpense, debit: expense.amount },
      { account: expense.is_paid ? (PAYMENT_ACCOUNT[expense.payment_method] || ACCOUNTS.cash) : ACCOUNTS.payables, credit: expense.amount },
    ],
  });

module.exports = { ACCOUNTS, postEntry, reverseSource, postIncome, postExpense };
