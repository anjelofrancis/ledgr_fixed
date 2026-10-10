// Bill payments: sends a billing schedule's current due amount to M-Pesa.
// Shared by the "Pay now" button and the hourly cron job.
const { query } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

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
// PAY A BILL
// ============================================

// Claim the one live payment for the schedule's current due date (inserting it, or taking over
// a queued 'pending' row) and send it to M-Pesa.
// Returns { status: 'sent' | 'failed' | 'busy', transactionId, error }.
// 'busy' means a payment for that due date is already in progress or paid.
const payBill = async (schedule) => {
  const inserted = await query(
    `INSERT INTO billing_transactions (id, business_id, schedule_id, amount, status, due_date)
     VALUES ($1,$2,$3,$4,'processing',$5) ON CONFLICT DO NOTHING RETURNING id`,
    [uuidv4(), schedule.business_id, schedule.id, schedule.amount, schedule.next_due_date]
  );
  const claimed = inserted.rows.length ? inserted : await query(
    `UPDATE billing_transactions SET status = 'processing', initiated_at = NOW()
     WHERE schedule_id = $1 AND due_date = $2 AND status = 'pending' RETURNING id`,
    [schedule.id, schedule.next_due_date]
  );
  if (!claimed.rows.length) return { status: 'busy' };
  const transactionId = claimed.rows[0].id;

  try {
    const result = await stkPush({
      phone: schedule.payee_number,
      amount: schedule.amount,
      accountRef: schedule.account_ref || schedule.name,
      description: `LEDGR: ${schedule.name}`,
    });
    const accepted = result.ResponseCode === '0';
    const error = accepted ? null : (result.errorMessage || result.ResponseDescription || 'Rejected by M-Pesa');

    await query(
      `UPDATE billing_transactions SET mpesa_checkout_id = $1, status = $2, error_message = $3 WHERE id = $4`,
      [result.CheckoutRequestID || null, accepted ? 'processing' : 'failed', error, transactionId]
    );

    if (accepted) {
      // Update next due date
      const next = new Date();
      next.setMonth(next.getMonth() + 1);
      next.setDate(schedule.billing_day);
      await query(
        'UPDATE billing_schedules SET last_paid_at = NOW(), next_due_date = $1 WHERE id = $2',
        [next.toISOString().split('T')[0], schedule.id]
      );
    }
    return { status: accepted ? 'sent' : 'failed', transactionId, error };
  } catch (err) {
    await query(
      `UPDATE billing_transactions SET status = 'failed', error_message = $1 WHERE id = $2`,
      [err.message, transactionId]
    );
    return { status: 'failed', transactionId, error: err.message };
  }
};

module.exports = { stkPush, payBill };
