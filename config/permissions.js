// ============================================
// PERMISSIONS
// A user's effective permissions = their role's defaults + any extra grants
// stored in user_permissions. Routes check permissions, never role names.
// ============================================

const PERMISSIONS = {
  'dashboard.view':       'View the dashboard and business totals',
  'reports.view':         'View analytics, forecasts, statements and search',

  'income.view':          'View income records',
  'income.create':        'Record income',
  'income.void':          'Void income records',
  'expenses.view':        'View expenses',
  'expenses.create':      'Log expenses',
  'expenses.void':        'Void expenses',

  'inventory.view':       'View inventory and stock history',
  'inventory.manage':     'Add, edit and adjust stock',
  'inventory.archive':    'Archive inventory items',
  'pos.sell':             'Use the point of sale',
  'sales.view':           'View sales history',
  'quotations.view':      'View quotations',
  'quotations.manage':    'Create, edit, send and convert quotations',

  'billing.view':         'View bill schedules and payments',
  'billing.manage':       'Create bill schedules',
  'billing.pay':          'Trigger payments and stop bill schedules',
  'payroll.view':         'View payroll runs and payslips',
  'payroll.manage':       'Prepare payroll runs',
  'payroll.approve':      'Approve payroll runs',
  'tax.view':             'View tax records',
  'tax.manage':           'Create tax records',
  'tax.pay':              'Mark tax as paid',
  'savings.view':         'View savings allocations',
  'savings.manage':       'Compute and transfer savings',

  'employees.view':       'View employees (including salaries)',
  'employees.manage':     'Add and edit employees and departments',
  'employees.deactivate': 'Deactivate employees',

  'settings.view':        'Open settings',
  'settings.business':    'Edit the business profile',
  'users.manage':         'Invite users, change roles and permissions',
  'activity.view':        'View the activity log',
};

const ALL = Object.keys(PERMISSIONS);

const ROLES = {
  admin: { label: 'Admin', permissions: ALL },

  manager: {
    label: 'Manager',
    permissions: ALL.filter(p => ![
      'inventory.archive', 'billing.pay', 'payroll.approve', 'tax.pay',
      'employees.deactivate', 'settings.business', 'users.manage', 'activity.view',
    ].includes(p)),
  },

  accountant: {
    label: 'Accountant',
    permissions: [
      'dashboard.view', 'reports.view',
      'income.view', 'income.create', 'income.void',
      'expenses.view', 'expenses.create', 'expenses.void',
      'inventory.view', 'sales.view', 'quotations.view',
      'billing.view', 'payroll.view', 'tax.view', 'tax.manage',
      'savings.view', 'savings.manage', 'employees.view',
    ],
  },

  user: {
    label: 'Staff',
    permissions: [
      'dashboard.view',
      'income.view', 'income.create', 'expenses.view', 'expenses.create',
      'inventory.view', 'pos.sell', 'sales.view', 'quotations.view',
    ],
  },

  cashier: {
    label: 'Cashier',
    permissions: ['pos.sell', 'sales.view'],
  },
};

const ROLE_NAMES = Object.keys(ROLES);

// Build the effective permission set for a role plus extra grants.
const resolvePermissions = (role, grants = []) =>
  new Set([...(ROLES[role]?.permissions || []), ...grants.filter(p => PERMISSIONS[p])]);

module.exports = { PERMISSIONS, ROLES, ROLE_NAMES, resolvePermissions };
