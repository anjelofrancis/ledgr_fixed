const { query } = require('../../config/database');
const { getPlans } = require('../utils/entitlements');

const FEATURE_LABELS = {
  pos: 'Inventory & point of sale',
  automated_billing: 'Automated M-Pesa bill payments',
  forecast: 'Forecasting',
  api_access: 'API access',
};

// GET /settings/plan
const showPlan = async (req, res) => {
  try {
    const [plans, employees] = await Promise.all([
      getPlans(),
      query('SELECT COUNT(*)::int AS n FROM employees WHERE business_id = $1 AND is_active = true', [req.user.business_id]),
    ]);
    res.render('pages/settings/plan', {
      title: 'Plan & Billing — LEDGR',
      plans: Object.values(plans).filter(p => p.is_public),
      ent: req.entitlements,
      usage: { employees: employees.rows[0].n },
      featureLabels: FEATURE_LABELS,
    });
  } catch (err) {
    console.error('Plan page error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load plan.', code: 500 });
  }
};

module.exports = { showPlan };
