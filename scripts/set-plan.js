// Operator tool: change a business's LEDGR subscription after payment is received.
//
//   npm run set-plan -- <business-or-admin-email> <plan> [months]
//   npm run set-plan -- shop@example.com pro 12      # Pro, paid for 12 months from today
//   npm run set-plan -- shop@example.com free        # move to Free (no end date)
//   npm run set-plan -- shop@example.com cancel      # stop renewing; keeps access until paid-through date
//
// Every change is written to the business's audit log.
require('dotenv').config();
const { pool, getClient } = require('../config/database');
const { logAudit } = require('../src/utils/audit');

async function main() {
  const [email, planArg, monthsArg] = process.argv.slice(2);
  if (!email || !planArg) {
    console.error('Usage: npm run set-plan -- <business-or-admin-email> <plan|cancel> [months]');
    process.exitCode = 1;
    return;
  }
  const months = monthsArg === undefined ? 1 : parseInt(monthsArg, 10);
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    console.error('months must be a whole number from 1 to 36');
    process.exitCode = 1;
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const biz = await client.query(
      `SELECT b.id, b.name FROM businesses b
       WHERE b.email = $1 OR b.id = (SELECT business_id FROM users WHERE email = $1 LIMIT 1)
       LIMIT 1`,
      [email]
    );
    if (!biz.rows.length) throw new Error(`No business found for ${email}`);
    const { id: businessId, name } = biz.rows[0];

    const before = (await client.query('SELECT * FROM subscriptions WHERE business_id = $1 FOR UPDATE', [businessId])).rows[0] || null;
    let after;

    if (planArg === 'cancel') {
      if (!before) throw new Error('This business has no subscription to cancel');
      after = (await client.query(
        `UPDATE subscriptions SET status = 'cancelled', notes = 'Cancelled by operator' WHERE business_id = $1 RETURNING *`,
        [businessId]
      )).rows[0];
    } else {
      const plan = (await client.query('SELECT code, price_monthly FROM plans WHERE code = $1', [planArg])).rows[0];
      if (!plan) throw new Error(`Unknown plan "${planArg}"`);
      const isFree = Number(plan.price_monthly) === 0;
      after = (await client.query(
        `INSERT INTO subscriptions (business_id, plan_code, status, trial_ends_at, current_period_end, notes)
         VALUES ($1, $2, 'active', NULL, CASE WHEN $3 THEN NULL ELSE NOW() + make_interval(months => $4::int) END, $5)
         ON CONFLICT (business_id) DO UPDATE SET
           plan_code = EXCLUDED.plan_code, status = 'active', trial_ends_at = NULL,
           current_period_end = EXCLUDED.current_period_end, notes = EXCLUDED.notes
         RETURNING *`,
        [businessId, plan.code, isFree, months, isFree ? 'Set by operator' : `Paid ${months} month(s), set by operator`]
      )).rows[0];
    }

    await logAudit(null, {
      action: 'subscription.change', entityType: 'subscription', entityId: after.id, client,
      businessId, userId: null,
      oldValues: before && { plan_code: before.plan_code, status: before.status, current_period_end: before.current_period_end },
      newValues: { plan_code: after.plan_code, status: after.status, current_period_end: after.current_period_end, via: 'set-plan script' },
    });
    await client.query('COMMIT');

    const until = after.current_period_end ? new Date(after.current_period_end).toDateString() : 'no end date';
    console.log(`✅ ${name}: ${after.plan_code} (${after.status}), ${until}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
