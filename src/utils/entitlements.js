const { query } = require('../../config/database');

// Days a paid plan keeps working after its period ends while payment is sorted out.
const GRACE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

// Plans change rarely; cache them briefly instead of querying on every request.
let planCache = { at: 0, plans: null };
const getPlans = async () => {
  if (!planCache.plans || Date.now() - planCache.at > 60 * 1000) {
    const result = await query('SELECT * FROM plans ORDER BY sort_order');
    planCache = { at: Date.now(), plans: Object.fromEntries(result.rows.map(p => [p.code, p])) };
  }
  return planCache.plans;
};

/**
 * Work out which plan a subscription currently grants.
 * Returns { planCode, state } where state is one of:
 *   trial, trial_ended, active, grace, cancelled (paid until period end), lapsed, none
 * Anything that is not (or no longer) paid for falls back to the free plan.
 */
const resolveSubscription = (sub, now = new Date()) => {
  if (!sub) return { planCode: 'free', state: 'none' };
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const inGrace = periodEnd && now < new Date(periodEnd.getTime() + GRACE_DAYS * DAY);

  switch (sub.status) {
    case 'trialing':
      return sub.trial_ends_at && now < new Date(sub.trial_ends_at)
        ? { planCode: sub.plan_code, state: 'trial' }
        : { planCode: 'free', state: 'trial_ended' };
    case 'active':
      if (!periodEnd || now < periodEnd) return { planCode: sub.plan_code, state: 'active' };
      return inGrace ? { planCode: sub.plan_code, state: 'grace' } : { planCode: 'free', state: 'lapsed' };
    case 'past_due':
      return inGrace ? { planCode: sub.plan_code, state: 'grace' } : { planCode: 'free', state: 'lapsed' };
    case 'cancelled':
      return periodEnd && now < periodEnd
        ? { planCode: sub.plan_code, state: 'cancelled' }
        : { planCode: 'free', state: 'lapsed' };
    default:
      return { planCode: 'free', state: 'none' };
  }
};

// Load what a business is entitled to right now.
const getEntitlements = async (businessId) => {
  const [plans, subResult] = await Promise.all([
    getPlans(),
    query('SELECT * FROM subscriptions WHERE business_id = $1', [businessId]),
  ]);
  const subscription = subResult.rows[0] || null;
  const { planCode, state } = resolveSubscription(subscription);
  const plan = plans[planCode] || plans.free;
  const features = new Set(plan.features || []);
  const limits = plan.limits || {};
  const trialEndsAt = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) : null;

  return {
    plan,                                            // the plan in effect now
    subscribedPlan: subscription ? plans[subscription.plan_code] : null,
    subscription,
    state,
    trialDaysLeft: state === 'trial' ? Math.ceil((trialEndsAt - Date.now()) / DAY) : null,
    features,
    limits,
    has: (feature) => features.has(feature),
    limit: (key) => (limits[key] === undefined ? null : Number(limits[key])), // null = unlimited
  };
};

module.exports = { getEntitlements, getPlans, resolveSubscription, GRACE_DAYS };
