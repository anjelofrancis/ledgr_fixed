const { query } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('../utils/audit');

// ============================================
// M-PESA DARAJA HELPERS
// ============================================

const getAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const url = process.env.MPESA_ENVIRONMENT === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json();
  return data.access_token;
};

const stkPush = async ({ phone, amount, accountRef, description }) => {
  const token = await getAccessToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const shortcode = process.env.MPESA_BUSINESS_SHORTCODE;
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

  const url = process.env.MPESA_ENVIRONMENT === 'production'
    ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone.replace(/^0/, '254'),
      PartyB: shortcode,
      PhoneNumber: phone.replace(/^0/, '254'),
      CallBackURL: `${process.env.MPESA_CALLBACK_URL}/billing/callback`,
      AccountReference: accountRef,
      TransactionDesc: description,
    }),
  });
  return res.json();
};

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

  // One live payment per due date: take over a queued one, or refuse if it's already in flight or paid
  const inserted = await query(
    `INSERT INTO billing_transactions (id, business_id, schedule_id, amount, status, due_date)
     VALUES ($1,$2,$3,$4,'processing',$5) ON CONFLICT DO NOTHING RETURNING id`,
    [uuidv4(), req.user.business_id, id, s.amount, s.next_due_date]
  );
  const claimed = inserted.rows.length ? inserted : await query(
    `UPDATE billing_transactions SET status = 'processing', initiated_at = NOW()
     WHERE schedule_id = $1 AND due_date = $2 AND status = 'pending' RETURNING id`,
    [id, s.next_due_date]
  );
  if (!claimed.rows.length) return res.redirect('/billing?inprogress=1');
  const txId = claimed.rows[0].id;

  await logAudit(req, {
    action: 'billing.payment_trigger', entityType: 'billing_schedule', entityId: id,
    newValues: { transactionId: txId, amount: s.amount, payee: s.payee_number },
  });

  try {
    const result = await stkPush({
      phone: s.payee_number,
      amount: s.amount,
      accountRef: s.account_ref || s.name,
      description: `LEDGR: ${s.name}`,
    });

    await query(
      `UPDATE billing_transactions SET mpesa_checkout_id = $1, status = $2 WHERE id = $3`,
      [result.CheckoutRequestID || null,
       result.ResponseCode === '0' ? 'processing' : 'failed',
       txId]
    );

    if (result.ResponseCode === '0') {
      // Update next due date
      const next = new Date();
      next.setMonth(next.getMonth() + 1);
      next.setDate(s.billing_day);
      await query(
        'UPDATE billing_schedules SET last_paid_at = NOW(), next_due_date = $1 WHERE id = $2',
        [next.toISOString().split('T')[0], id]
      );
    }
  } catch (err) {
    await query(
      `UPDATE billing_transactions SET status = 'failed', error_message = $1 WHERE id = $2`,
      [err.message, txId]
    );
  }

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

  const updated = await query(
    `UPDATE billing_transactions
     SET status = $1, mpesa_ref = $2, completed_at = NOW(), error_message = $3
     WHERE mpesa_checkout_id = $4 RETURNING id, business_id, amount`,
    [success ? 'completed' : 'failed', mpesaRef, success ? null : cb.ResultDesc, checkoutId]
  );
  for (const tx of updated.rows) {
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
