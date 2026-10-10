const { query } = require('../../config/database');

// Strip fields that must never be written to the audit trail.
const SENSITIVE = ['password', 'password_hash', 'currentPassword', 'newPassword', 'password_reset_token'];
const scrub = (values) => {
  if (!values || typeof values !== 'object') return values ?? null;
  const copy = { ...values };
  for (const key of SENSITIVE) delete copy[key];
  return copy;
};

/**
 * Record an action in audit_logs: who, what, when, where, before and after.
 *
 * logAudit(req, { action: 'income.void', entityType: 'income_record', entityId, oldValues, newValues })
 *
 * Pass `client` to write inside an open transaction so the log commits or rolls back with the change.
 * Pass `businessId`/`userId` explicitly when req.user is not set (e.g. failed logins).
 * Never throws: an audit failure is logged to the console but does not break the request.
 */
const logAudit = async (req, { action, entityType = null, entityId = null, oldValues = null, newValues = null, businessId, userId, client } = {}) => {
  const db = client || { query };
  try {
    // Inside a transaction, a failed INSERT would abort the caller's transaction, so isolate it.
    if (client) await client.query('SAVEPOINT audit_log');
    await db.query(
      `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        businessId !== undefined ? businessId : req?.user?.business_id || null,
        userId !== undefined ? userId : req?.user?.id || null,
        action,
        entityType,
        entityId,
        oldValues ? JSON.stringify(scrub(oldValues)) : null,
        newValues ? JSON.stringify(scrub(newValues)) : null,
        req?.ip || null,
        req?.get?.('user-agent')?.slice(0, 500) || null,
      ]
    );
    if (client) await client.query('RELEASE SAVEPOINT audit_log');
  } catch (err) {
    console.error('[AUDIT] Failed to record', action, '-', err.message);
    if (client) await client.query('ROLLBACK TO SAVEPOINT audit_log').catch(() => {});
  }
};

module.exports = { logAudit };
