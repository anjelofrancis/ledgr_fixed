const { query, getClient } = require('../../config/database');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../utils/audit');
const { PERMISSIONS, ROLES, ROLE_NAMES } = require('../../config/permissions');

const showSettings = async (req, res) => {
  const [business, users] = await Promise.all([
    query('SELECT * FROM businesses WHERE id = $1', [req.user.business_id]),
    query(
      'SELECT id, first_name, last_name, email, role, is_active, last_login FROM users WHERE business_id = $1 ORDER BY role, first_name',
      [req.user.business_id]
    ),
  ]);
  res.render('pages/settings/index', {
    title: 'Settings — LEDGR',
    business: business.rows[0],
    users: users.rows,
    roles: ROLES,
    success: req.query.success || null,
  });
};

const updateBusiness = async (req, res) => {
  const { name, type, kraPin, phone, address, currency, savingsRate, vatRate, hasPos } = req.body;
  const before = await query('SELECT * FROM businesses WHERE id = $1', [req.user.business_id]);
  const after = await query(
    `UPDATE businesses SET name=$1, type=$2, kra_pin=$3, phone=$4, address=$5,
     currency=$6, savings_rate=$7, vat_rate=$8, has_pos=$9 WHERE id=$10 RETURNING *`,
    [name, type, kraPin || null, phone || null, address || null,
     currency || 'KES', parseFloat(savingsRate) || 10,
     parseFloat(vatRate) || 16, hasPos === 'true', req.user.business_id]
  );
  await logAudit(req, {
    action: 'business.update', entityType: 'business', entityId: req.user.business_id,
    oldValues: before.rows[0], newValues: after.rows[0],
  });
  res.redirect('/settings?success=business');
};

const inviteUser = async (req, res) => {
  const { firstName, lastName, email, role } = req.body;
  const { v4: uuidv4 } = require('uuid');
  if (!ROLE_NAMES.includes(role || 'user')) return res.redirect('/settings?error=invalid_role');
  // Sign-in looks users up by email alone, so an email may only belong to one account
  const taken = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (taken.rows.length) return res.redirect('/settings?error=email_taken');
  const tempPassword = Math.random().toString(36).slice(-10);
  const hash = await bcrypt.hash(tempPassword, 12);
  try {
    const newUserId = uuidv4();
    await query(
      `INSERT INTO users (id, business_id, first_name, last_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newUserId, req.user.business_id, firstName, lastName, email, hash, role || 'user']
    );
    await logAudit(req, {
      action: 'user.invite', entityType: 'user', entityId: newUserId,
      newValues: { firstName, lastName, email, role: role || 'user' },
    });
    // Only log temp password in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[INVITE] ${email} — temp password: ${tempPassword}`);
    }
    res.redirect('/settings?success=invited');
  } catch (err) {
    console.error('Invite error:', err.message);
    res.redirect('/settings?error=invite_failed');
  }
};

const toggleUser = async (req, res) => {
  const result = await query(
    'UPDATE users SET is_active = NOT is_active WHERE id = $1 AND business_id = $2 AND id != $3 RETURNING id, email, is_active',
    [req.params.id, req.user.business_id, req.user.id]
  );
  if (result.rows.length) {
    const u = result.rows[0];
    await logAudit(req, {
      action: u.is_active ? 'user.activate' : 'user.deactivate', entityType: 'user', entityId: u.id,
      oldValues: { is_active: !u.is_active }, newValues: { email: u.email, is_active: u.is_active },
    });
  }
  res.redirect('/settings?success=user');
};

const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.redirect('/settings?error=password_too_short');
  }
  const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows.length) {
    return res.redirect('/settings?error=user_not_found');
  }
  const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!valid) {
    await logAudit(req, { action: 'user.password_change_failed', entityType: 'user', entityId: req.user.id });
    return res.redirect('/settings?error=wrong_password');
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  await logAudit(req, { action: 'user.password_change', entityType: 'user', entityId: req.user.id });
  res.redirect('/settings?success=password');
};

// GET /settings/users/:id/access
const showAccess = async (req, res) => {
  const [member, grants] = await Promise.all([
    query('SELECT id, first_name, last_name, email, role FROM users WHERE id = $1 AND business_id = $2', [req.params.id, req.user.business_id]),
    query('SELECT permission FROM user_permissions WHERE user_id = $1', [req.params.id]),
  ]);
  if (!member.rows.length) return res.redirect('/settings');
  res.render('pages/settings/access', {
    title: 'User Access — LEDGR',
    member: member.rows[0],
    grants: grants.rows.map(g => g.permission),
    roles: ROLES,
    permissions: PERMISSIONS,
    error: req.query.error || null,
    success: req.query.success || null,
  });
};

// POST /settings/users/:id/access — change role and extra permission grants
const updateAccess = async (req, res) => {
  const { role } = req.body;
  const back = `/settings/users/${req.params.id}/access`;
  if (!ROLE_NAMES.includes(role)) return res.redirect(`${back}?error=invalid_role`);
  // Stop admins locking themselves out of user management
  if (req.params.id === req.user.id && role !== 'admin') return res.redirect(`${back}?error=self_demote`);

  // Only store grants the role doesn't already include
  const requested = [].concat(req.body.permissions || []).filter(p => PERMISSIONS[p]);
  const grants = [...new Set(requested)].filter(p => !ROLES[role].permissions.includes(p)).sort();

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      'SELECT role FROM users WHERE id = $1 AND business_id = $2 FOR UPDATE', [req.params.id, req.user.business_id]
    );
    if (!before.rows.length) { await client.query('ROLLBACK'); return res.redirect('/settings'); }
    const oldGrants = await client.query('SELECT permission FROM user_permissions WHERE user_id = $1 ORDER BY permission', [req.params.id]);

    await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [req.params.id]);
    for (const p of grants) {
      await client.query(
        'INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ($1, $2, $3)',
        [req.params.id, p, req.user.id]
      );
    }
    await logAudit(req, {
      action: 'user.access_change', entityType: 'user', entityId: req.params.id, client,
      oldValues: { role: before.rows[0].role, grants: oldGrants.rows.map(r => r.permission) },
      newValues: { role, grants },
    });
    await client.query('COMMIT');
    res.redirect(`${back}?success=1`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update access error:', err);
    res.redirect(`${back}?error=save_failed`);
  } finally {
    client.release();
  }
};

module.exports = { showSettings, updateBusiness, inviteUser, toggleUser, updatePassword, showAccess, updateAccess };
