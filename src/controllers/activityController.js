const { query } = require('../../config/database');

const PAGE_SIZE = 50;

// Action prefixes offered as filters, matching the "<area>.<verb>" names written by logAudit.
const AREAS = ['auth', 'business', 'user', 'income', 'expense', 'inventory', 'sale', 'quotation',
  'employee', 'payroll', 'tax', 'savings', 'billing'];

// GET /settings/activity
const listActivity = async (req, res) => {
  const businessId = req.user.business_id;
  const area = AREAS.includes(req.query.area) ? req.query.area : null;
  const userId = /^[0-9a-f-]{36}$/i.test(req.query.user || '') ? req.query.user : null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = ['a.business_id = $1'];
  const params = [businessId];
  if (area) { params.push(`${area}.%`); where.push(`a.action LIKE $${params.length}`); }
  if (userId) { params.push(userId); where.push(`a.user_id = $${params.length}`); }

  try {
    const [logs, users] = await Promise.all([
      query(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.old_values, a.new_values,
                a.ip_address, a.created_at, u.first_name, u.last_name, u.email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY a.created_at DESC
         LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`,
        params
      ),
      query('SELECT id, first_name, last_name FROM users WHERE business_id = $1 ORDER BY first_name', [businessId]),
    ]);

    res.render('pages/settings/activity', {
      title: 'Activity Log — LEDGR',
      logs: logs.rows.slice(0, PAGE_SIZE),
      hasMore: logs.rows.length > PAGE_SIZE,
      users: users.rows,
      areas: AREAS,
      filters: { area, user: userId, page },
    });
  } catch (err) {
    console.error('Activity log error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load activity log.', code: 500 });
  }
};

module.exports = { listActivity };
