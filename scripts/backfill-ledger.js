// Post journal entries for income and expenses recorded before the ledger existed.
// Safe to run repeatedly: records that already have entries are skipped.
//
//   npm run ledger:backfill
require('dotenv').config();
const { pool, query, withTransaction } = require('../config/database');
const { postIncome, postExpense, reverseSource } = require('../src/utils/ledger');

async function backfillBusiness(business) {
  return withTransaction(async (client) => {
    await client.query('SELECT seed_chart_of_accounts($1)', [business.id]);
    const counts = { income: 0, expenses: 0, reversals: 0 };

    const income = await client.query(
      `SELECT i.* FROM income_records i
       WHERE i.business_id = $1
         AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source_type = 'income_record' AND e.source_id = i.id)
       ORDER BY i.date, i.created_at`,
      [business.id]
    );
    for (const row of income.rows) {
      if (await postIncome(client, row, row.recorded_by)) counts.income++;
      if (row.voided_at && await reverseSource(client, {
        businessId: business.id, sourceType: 'income_record', sourceId: row.id,
        date: row.voided_at, reason: row.void_reason, userId: row.voided_by,
      })) counts.reversals++;
    }

    const expenses = await client.query(
      `SELECT x.*, c.type AS category_type FROM expenses x
       LEFT JOIN expense_categories c ON c.id = x.category_id AND c.business_id = x.business_id
       WHERE x.business_id = $1
         AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source_type = 'expense' AND e.source_id = x.id)
       ORDER BY x.date, x.created_at`,
      [business.id]
    );
    for (const row of expenses.rows) {
      if (await postExpense(client, row, row.category_type, row.recorded_by)) counts.expenses++;
      if (row.voided_at && await reverseSource(client, {
        businessId: business.id, sourceType: 'expense', sourceId: row.id,
        date: row.voided_at, reason: row.void_reason, userId: row.voided_by,
      })) counts.reversals++;
    }
    return counts;
  });
}

async function main() {
  try {
    const businesses = await query('SELECT id, name FROM businesses ORDER BY created_at');
    for (const business of businesses.rows) {
      const c = await backfillBusiness(business);
      console.log(`✅ ${business.name}: ${c.income} income, ${c.expenses} expenses, ${c.reversals} reversals posted`);
    }
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
