// LEDGR Cron Jobs — Part 4
// Run separately: node src/utils/cron.js
// Or integrate with a process manager (PM2)

const { query } = require('../../config/database');
const { notifyBillingReminder, notifyBillingFailed } = require('./notifications');
const { getEntitlements } = require('./entitlements');
const { payBill } = require('./billPayments');
const { logAudit } = require('./audit');

// Simple interval-based scheduler (use node-cron in production)
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// M-Pesa prompts expire within minutes; a payment with no callback after this long never went through.
const STALE_PAYMENT_HOURS = 2;

// Fail payments M-Pesa never confirmed, so they stop blocking a retry for that due date
async function expireStalePayments() {
  const stale = await query(
    `UPDATE billing_transactions
     SET status = 'failed', completed_at = NOW(), error_message = 'No confirmation from M-Pesa'
     WHERE status = 'processing' AND initiated_at < NOW() - make_interval(hours => $1)
     RETURNING id, business_id, schedule_id, amount`,
    [STALE_PAYMENT_HOURS]
  );
  for (const tx of stale.rows) {
    console.log(`[CRON] Payment ${tx.id} expired without confirmation`);
    await logAudit(null, {
      action: 'billing.payment_failed', entityType: 'billing_transaction', entityId: tx.id,
      businessId: tx.business_id, userId: null,
      newValues: { amount: tx.amount, resultDesc: 'No confirmation from M-Pesa', via: 'timeout' },
    });
  }
}

// Failed attempts per due date before the job stops retrying (the hourly run spaces them out).
// "Pay now" is not limited.
const MAX_AUTO_ATTEMPTS = 3;

// Tell the business, once per due date, that automatic payment has given up
async function alertGaveUp(bill, { attempts, last_error: lastError }) {
  const claimed = await query(
    `UPDATE billing_schedules SET failure_alerted_for = next_due_date
     WHERE id = $1 AND failure_alerted_for IS DISTINCT FROM next_due_date RETURNING id`,
    [bill.id]
  );
  if (!claimed.rows.length) return;
  console.log(`[CRON] Giving up on ${bill.name} after ${attempts} failed attempts`);
  await logAudit(null, {
    action: 'billing.payment_gave_up', entityType: 'billing_schedule', entityId: bill.id,
    businessId: bill.business_id, userId: null,
    newValues: { dueDate: bill.next_due_date, attempts, lastError },
  });
  await notifyBillingFailed({
    email: bill.business_email, businessName: bill.business_name, billName: bill.name,
    amount: bill.amount, dueDate: bill.next_due_date, attempts, lastError,
  }).catch(err => console.error('[CRON] Failure alert email error:', err.message));
}

// Check and trigger due bills — runs every hour
async function processDueBills() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[CRON] Checking due bills for ${today}`);

  try {
    await expireStalePayments();

    const due = await query(
      `SELECT bs.*, b.email AS business_email, b.name AS business_name
       FROM billing_schedules bs
       JOIN businesses b ON b.id = bs.business_id
       WHERE bs.is_active = true AND bs.next_due_date <= $1`,
      [today]
    );

    for (const bill of due.rows) {
      try {
        if (!(await getEntitlements(bill.business_id)).has('automated_billing')) continue;

        const failed = (await query(
          `SELECT count(*)::int AS attempts, (array_agg(error_message ORDER BY initiated_at DESC))[1] AS last_error
           FROM billing_transactions WHERE schedule_id = $1 AND due_date = $2 AND status = 'failed'`,
          [bill.id, bill.next_due_date]
        )).rows[0];
        if (failed.attempts >= MAX_AUTO_ATTEMPTS) {
          await alertGaveUp(bill, failed);
          continue;
        }

        // payBill claims the one live payment for this due date, so an in-flight or paid bill is skipped
        const result = await payBill(bill);
        if (result.status === 'busy') continue;
        console.log(`[CRON] ${bill.name} — KES ${bill.amount}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
        await logAudit(null, {
          action: 'billing.payment_auto', entityType: 'billing_schedule', entityId: bill.id,
          businessId: bill.business_id, userId: null,
          newValues: { transactionId: result.transactionId, amount: bill.amount, dueDate: bill.next_due_date, result: result.status, error: result.error },
        });
      } catch (err) {
        console.error(`[CRON] Bill ${bill.id} error:`, err.message);
      }
    }
  } catch (err) {
    console.error('[CRON] Due bills error:', err.message);
  }
}

// Send reminders for bills due in 3 days — runs once daily at 8am
async function sendBillingReminders() {
  const threeDays = new Date();
  threeDays.setDate(threeDays.getDate() + 3);
  const targetDate = threeDays.toISOString().split('T')[0];

  try {
    const upcoming = await query(
      `SELECT bs.name, bs.amount, bs.next_due_date, b.email, b.name AS business_name
       FROM billing_schedules bs
       JOIN businesses b ON b.id = bs.business_id
       WHERE bs.is_active = true AND bs.next_due_date = $1`,
      [targetDate]
    );

    for (const bill of upcoming.rows) {
      if (bill.email) {
        await notifyBillingReminder({
          email: bill.email,
          businessName: bill.business_name,
          billName: bill.name,
          amount: bill.amount,
          dueDate: bill.next_due_date,
        });
        console.log(`[CRON] Reminder sent: ${bill.name} due ${bill.next_due_date}`);
      }
    }
  } catch (err) {
    console.error('[CRON] Reminder error:', err.message);
  }
}

// Monthly savings computation — runs on 1st of each month
async function computeMonthlySavings() {
  const now = new Date();
  if (now.getDate() !== 1) return;
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  try {
    const businesses = await query('SELECT id, savings_rate FROM businesses');
    for (const biz of businesses.rows) {
      const [income, expenses] = await Promise.all([
        query(
          'SELECT COALESCE(SUM(amount),0) AS t FROM income_records WHERE business_id=$1 AND voided_at IS NULL AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3',
          [biz.id, lastMonth, lastYear]
        ),
        query(
          'SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE business_id=$1 AND voided_at IS NULL AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3',
          [biz.id, lastMonth, lastYear]
        ),
      ]);
      const net = parseFloat(income.rows[0].t) - parseFloat(expenses.rows[0].t);
      if (net > 0) {
        const amount = net * (parseFloat(biz.savings_rate) / 100);
        await query(
          `INSERT INTO savings_allocations (id, business_id, period_month, period_year, net_income, savings_rate, amount)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [biz.id, lastMonth, lastYear, net, biz.savings_rate, amount]
        );
        console.log(`[CRON] Savings computed for business ${biz.id}: KES ${amount.toFixed(0)}`);
      }
    }
  } catch (err) {
    console.error('[CRON] Savings error:', err.message);
  }
}

// Daily jobs run once per Nairobi calendar day, on the first hourly tick at or after 8am.
const TIME_ZONE = 'Africa/Nairobi';
const DAILY_HOUR = 8;
const DAILY_JOBS = {
  billing_reminders: () => sendBillingReminders(),
  monthly_savings: () => computeMonthlySavings(),
};

const localClock = (now) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) };
};

// Claims today's slot in job_runs before running, so restarts and overlapping ticks can't run a job twice
async function runDailyJobs(now = new Date()) {
  const { date, hour } = localClock(now);
  if (hour < DAILY_HOUR) return;
  for (const [job, run] of Object.entries(DAILY_JOBS)) {
    try {
      const claimed = await query(
        'INSERT INTO job_runs (job, run_on) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING job',
        [job, date]
      );
      if (!claimed.rows.length) continue;
      console.log(`[CRON] Running daily job ${job} for ${date}`);
      await run();
    } catch (err) {
      console.error(`[CRON] Daily job ${job} error:`, err.message);
    }
  }
}

async function tick() {
  await processDueBills();
  await runDailyJobs();
}

// Start schedulers
if (require.main === module) {
  console.log('🕐 LEDGR Cron service started');
  tick();
  setInterval(tick, HOUR);
}

module.exports = { processDueBills, expireStalePayments, sendBillingReminders, computeMonthlySavings, runDailyJobs };
