const { query } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const { payBill, markPaid } = require('../utils/billPayments');
const { logAudit } = require('../utils/audit');

// ============================================
// BILLING CONTROLLERS
// ============================================

const listBilling = async (req, res) => {
  const [schedules, recent] = await Promise.all([
    query(
      'SELECT * FROM billing_schedules WHERE business_id = $1 AND is_active = true ORDER BY billing_day',
      [req.user.business_id]
    ),
    query(
      `SELECT bt.*, bs.name AS schedule_name
       FROM billing_transactions bt
       LEFT JOIN billing_schedules bs ON bs.id = bt.schedule_id
       WHERE bt.business_id = $1
       ORDER BY bt.initiated_at DESC LIMIT 20`,
      [req.user.business_id]
    ),
  ]);

  res.render('pages/billing/index', {
    title: 'Billing — LEDGR',
    schedules: schedules.rows,
    transactions: recent.rows,
    notice: req.query.inprogress ? 'That bill already has a payment in progress or paid for its current due date.' : null,
  });
};

const showNewSchedule = (req, res) => {
  res.render('pages/billing/form', { title: 'Add Billing Schedule — LEDGR', schedule: null, error: null });
};

const createSchedule = async (req, res) => {
  const { name, category, amount, billingDay, paymentMethod, payeeNumber, accountRef } = req.body;
  const nextDue = new Date();
  nextDue.setDate(parseInt(billingDay));
  if (nextDue < new Date()) nextDue.setMonth(nextDue.getMonth() + 1);

  const scheduleId = uuidv4();
  await query(
    `INSERT INTO billing_schedules (id, business_id, name, category, amount, billing_day, payment_method, payee_number, account_ref, next_due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [scheduleId, req.user.business_id, name, category, parseFloat(amount),
     parseInt(billingDay), paymentMethod || 'mpesa', payeeNumber || null,
     accountRef || null, nextDue.toISOString().split('T')[0]]
  );
  await logAudit(req, {
    action: 'billing.schedule_create', entityType: 'billing_schedule', entityId: scheduleId,
    newValues: { name, category, amount: parseFloat(amount), billingDay, paymentMethod, payeeNumber, accountRef },
  });
  res.redirect('/billing?success=1');
};

const triggerPayment = async (req, res) => {
  const { id } = req.params;
  const schedule = await query(
    'SELECT * FROM billing_schedules WHERE id = $1 AND business_id = $2 AND is_active = true',
    [id, req.user.business_id]
  );
  if (!schedule.rows.length) return res.redirect('/billing');

  const s = schedule.rows[0];
  const result = await payBill(s);
  if (result.status === 'busy') return res.redirect('/billing?inprogress=1');

  await logAudit(req, {
    action: 'billing.payment_trigger', entityType: 'billing_schedule', entityId: id,
    newValues: { transactionId: result.transactionId, amount: s.amount, payee: s.payee_number, result: result.status, error: result.error },
  });

  res.redirect('/billing?triggered=1');
};

// POST /billing/callback (M-Pesa callback)
const mpesaCallback = async (req, res) => {
  const { Body } = req.body;
  if (!Body?.stkCallback) return res.json({ ResultCode: 0, ResultDesc: 'OK' });

  const cb = Body.stkCallback;
  const checkoutId = cb.CheckoutRequestID;
  const success = cb.ResultCode === 0;

  const mpesaRef = success
    ? cb.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value
    : null;

  // Only settle payments still in flight, so a repeated callback from Safaricom is a no-op
  const updated = await query(
    `UPDATE billing_transactions
     SET status = $1, mpesa_ref = $2, completed_at = NOW(), error_message = $3
     WHERE mpesa_checkout_id = $4 AND status = 'processing'
     RETURNING id, business_id, amount, schedule_id, due_date::text AS due_date`,
    [success ? 'completed' : 'failed', mpesaRef, success ? null : cb.ResultDesc, checkoutId]
  );
  for (const tx of updated.rows) {
    if (success) await markPaid({ scheduleId: tx.schedule_id, dueDate: tx.due_date });
    await logAudit(req, {
      action: success ? 'billing.payment_completed' : 'billing.payment_failed',
      entityType: 'billing_transaction', entityId: tx.id, businessId: tx.business_id, userId: null,
      newValues: { amount: tx.amount, mpesaRef, resultDesc: cb.ResultDesc, via: 'mpesa_callback' },
    });
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

// Deactivate rather than delete so past payments keep their schedule name.
const deactivateSchedule = async (req, res) => {
  const result = await query(
    'UPDATE billing_schedules SET is_active = false WHERE id = $1 AND business_id = $2 AND is_active = true RETURNING name, amount',
    [req.params.id, req.user.business_id]
  );
  if (result.rows.length) {
    await query(
      `UPDATE billing_transactions SET status = 'cancelled', completed_at = NOW(), error_message = 'Bill schedule was stopped'
       WHERE schedule_id = $1 AND status = 'pending'`,
      [req.params.id]
    );
    await logAudit(req, {
      action: 'billing.schedule_deactivate', entityType: 'billing_schedule', entityId: req.params.id,
      oldValues: { is_active: true }, newValues: { is_active: false, ...result.rows[0] },
    });
  }
  res.redirect('/billing?deactivated=1');
};

module.exports = { listBilling, showNewSchedule, createSchedule, triggerPayment, mpesaCallback, deactivateSchedule };
