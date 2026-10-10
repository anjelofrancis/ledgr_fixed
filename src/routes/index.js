const express = require('express');
const { body } = require('express-validator');
const { authenticate, requirePermission: can, optionalAuth } = require('../middleware/auth');

const authController     = require('../controllers/authController');
const dashboardController= require('../controllers/dashboardController');
const employeeController = require('../controllers/employeeController');
const incomeController   = require('../controllers/incomeController');
const expensesController = require('../controllers/expensesController');
const billingController  = require('../controllers/billingController');
const payrollController  = require('../controllers/payrollController');
const taxController      = require('../controllers/taxController');
const analyticsController= require('../controllers/analyticsController');
const savingsController  = require('../controllers/savingsController');
const statementsController=require('../controllers/statementsController');
const settingsController = require('../controllers/settingsController');
const forecastController = require('../controllers/forecastController');
const chatController = require('../controllers/chatController');
const inventoryController = require('../controllers/inventoryController');
const salesController = require('../controllers/salesController');
const quotationsController = require('../controllers/quotationsController');
const activityController = require('../controllers/activityController');

const router = express.Router();

// ── PUBLIC ───────────────────────────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  res.render('pages/landing', {
    title: 'LEDGR — Retail Finance Management',
    loggedIn: !!req.user,
    user: req.user || null,
  });
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
router.get('/auth/login', optionalAuth, authController.showLogin);
router.get('/auth/register', optionalAuth, authController.showRegister);
router.post('/auth/register', [
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('lastName').trim().notEmpty().withMessage('Last name required'),
  body('businessName').trim().notEmpty().withMessage('Business name required'),
  body('businessType').isIn(['boutique','supermarket','retail','other']).withMessage('Select a business type'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], authController.register);
router.post('/auth/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/logout', authController.logoutGet);   // allows typing /auth/logout in browser URL bar

// M-Pesa callback (public — called by Safaricom)
router.post('/billing/callback', billingController.mpesaCallback);

// ── Chatbot (Gemini) — public so it works on landing page ────────────────────
router.post('/api/chat', chatController.handleChat);

// Public quotation links (customers open these without an account)
router.get('/q/:token', optionalAuth, quotationsController.publicQuoteView);
router.post('/q/:token/action', quotationsController.publicQuoteAction);

// ── PROTECTED ────────────────────────────────────────────────────────────────
router.use(authenticate);

// Dashboard (POS-only users land on the till instead)
router.get('/dashboard', (req, res, next) => {
  if (req.user.can('dashboard.view')) return dashboardController.showDashboard(req, res, next);
  if (req.user.can('pos.sell')) return res.redirect('/sales/pos');
  next();
}, can('dashboard.view'));

// ── PART 1: Employees ────────────────────────────────────────────────────────
router.get('/employees', can('employees.view'), employeeController.listEmployees);
router.get('/employees/departments', can('employees.manage'), employeeController.listDepartments);
router.get('/employees/new', can('employees.manage'), employeeController.showNewForm);
router.post('/employees', can('employees.manage'), [
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('lastName').trim().notEmpty().withMessage('Last name required'),
  body('salary').isFloat({ min: 0 }).withMessage('Valid salary required'),
  body('startDate').isDate().withMessage('Valid start date required'),
], employeeController.createEmployee);
router.get('/employees/:id', can('employees.view'), employeeController.showEmployee);
router.get('/employees/:id/edit', can('employees.manage'), employeeController.showEditForm);
router.post('/employees/:id/update', can('employees.manage'), employeeController.updateEmployee);
router.post('/employees/:id/deactivate', can('employees.deactivate'), employeeController.deactivateEmployee);

// ── PART 2: Income ───────────────────────────────────────────────────────────
router.get('/income', can('income.view'), incomeController.listIncome);
router.get('/income/new', can('income.create'), incomeController.showNewForm);
router.post('/income', can('income.create'), [
  body('date').isDate().withMessage('Valid date required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount required'),
], incomeController.createIncome);
router.post('/income/:id/void', can('income.void'), incomeController.voidIncome);

// ── PART 2: Expenses ─────────────────────────────────────────────────────────
router.get('/expenses', can('expenses.view'), expensesController.listExpenses);
router.get('/expenses/new', can('expenses.create'), expensesController.showNewForm);
router.post('/expenses', can('expenses.create'), [
  body('date').isDate().withMessage('Valid date required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount required'),
  body('description').trim().notEmpty().withMessage('Description required'),
], expensesController.createExpense);
router.post('/expenses/:id/void', can('expenses.void'), expensesController.voidExpense);

// ── Inventory ────────────────────────────────────────────────────────────────
router.get('/inventory', can('inventory.view'), inventoryController.listItems);
router.get('/inventory/new', can('inventory.manage'), inventoryController.showNewForm);
router.post('/inventory', can('inventory.manage'), [
  body('name').trim().notEmpty().withMessage('Product name required'),
  body('costPrice').isFloat({ min: 0 }).withMessage('Valid cost price required'),
  body('sellPrice').isFloat({ min: 0 }).withMessage('Valid sell price required'),
  body('quantity').isInt({ min: 0 }).withMessage('Valid quantity required'),
  body('reorderLevel').isInt({ min: 0 }).withMessage('Valid reorder level required'),
], inventoryController.createItem);
router.get('/inventory/:id', can('inventory.view'), inventoryController.showItem);
router.get('/inventory/:id/edit', can('inventory.manage'), inventoryController.showEditForm);
router.post('/inventory/:id/update', can('inventory.manage'), [
  body('name').trim().notEmpty().withMessage('Product name required'),
  body('costPrice').isFloat({ min: 0 }).withMessage('Valid cost price required'),
  body('sellPrice').isFloat({ min: 0 }).withMessage('Valid sell price required'),
  body('reorderLevel').isInt({ min: 0 }).withMessage('Valid reorder level required'),
], inventoryController.updateItem);
router.post('/inventory/:id/archive', can('inventory.archive'), inventoryController.archiveItem);
router.post('/inventory/:id/adjust', can('inventory.manage'), [
  body('type').isIn(['restock', 'sale', 'adjustment', 'damage', 'return']).withMessage('Valid adjustment type required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
], inventoryController.adjustStock);

// ── Sales & POS ──────────────────────────────────────────────────────────────
router.get('/sales', can('sales.view'), salesController.listSales);
router.get('/sales/pos', can('pos.sell'), salesController.showPOS);
router.get('/api/sales/items', can('pos.sell'), salesController.searchItemsAPI);
router.post('/api/sales/checkout', can('pos.sell'), salesController.checkoutAPI);
router.get('/api/sales/receipt/:id', can('sales.view', 'pos.sell'), salesController.showReceiptAPI);

// ── Quotations & Estimates ───────────────────────────────────────────────────
router.get('/quotations', can('quotations.view'), quotationsController.listQuotations);
router.get('/quotations/new', can('quotations.manage'), quotationsController.showForm);
router.get('/quotations/:id/edit', can('quotations.manage'), quotationsController.showForm);
router.get('/quotations/:id', can('quotations.view'), quotationsController.viewQuotation);
router.post('/api/quotations', can('quotations.manage'), quotationsController.saveQuotationAPI);
router.post('/api/quotations/:id/status', can('quotations.manage'), quotationsController.updateStatusAPI);
router.post('/api/quotations/:id/convert', can('quotations.manage'), quotationsController.convertToSaleAPI);

// ── PART 2: Billing ──────────────────────────────────────────────────────────
router.get('/billing', can('billing.view'), billingController.listBilling);
router.get('/billing/new', can('billing.manage'), billingController.showNewSchedule);
router.post('/billing', can('billing.manage'), billingController.createSchedule);
router.post('/billing/:id/trigger', can('billing.pay'), billingController.triggerPayment);
router.post('/billing/:id/deactivate', can('billing.pay'), billingController.deactivateSchedule);

// ── PART 2: Payroll ──────────────────────────────────────────────────────────
router.get('/payroll', can('payroll.view'), payrollController.listPayroll);
router.get('/payroll/new', can('payroll.manage'), payrollController.showRunForm);
router.post('/payroll', can('payroll.manage'), payrollController.createRun);
router.get('/payroll/:id', can('payroll.view'), payrollController.showRun);
router.post('/payroll/:id/approve', can('payroll.approve'), payrollController.approveRun);

// ── PART 2: Tax ──────────────────────────────────────────────────────────────
router.get('/tax', can('tax.view'), taxController.listTax);
router.post('/tax', can('tax.manage'), taxController.createTaxRecord);
router.post('/tax/:id/paid', can('tax.pay'), taxController.markPaid);

// ── PART 3: Analytics ────────────────────────────────────────────────────────
router.get('/analytics', can('reports.view'), analyticsController.showAnalytics);

// ── PART 3: Forecast (Predictive) ──────────────────────────────────────
router.get('/forecast', can('reports.view'), forecastController.showForecast);
router.get('/api/forecast', can('reports.view'), forecastController.apiForecast);

// ── PART 3: Savings ──────────────────────────────────────────────────────────
router.get('/savings', can('savings.view'), savingsController.listSavings);
router.post('/savings/compute', can('savings.manage'), savingsController.computeAllocation);
router.post('/savings/:id/transfer', can('savings.manage'), savingsController.markTransferred);

// ── PART 3: Statements & Search ──────────────────────────────────────────────
router.get('/statements', can('reports.view'), statementsController.listStatements);
router.get('/statements/pl', can('reports.view'), statementsController.downloadPL);
router.get('/statements/payroll/:id', can('payroll.view'), statementsController.downloadPayslips);
router.get('/search', can('reports.view'), statementsController.search);

// ── PART 4: Settings ─────────────────────────────────────────────────────────
router.get('/settings', can('settings.view'), settingsController.showSettings);
router.post('/settings/business', can('settings.business'), settingsController.updateBusiness);
router.post('/settings/invite', can('users.manage'), settingsController.inviteUser);
router.post('/settings/users/:id/toggle', can('users.manage'), settingsController.toggleUser);
router.get('/settings/users/:id/access', can('users.manage'), settingsController.showAccess);
router.post('/settings/users/:id/access', can('users.manage'), settingsController.updateAccess);
router.post('/settings/password', settingsController.updatePassword);
router.get('/settings/activity', can('activity.view'), activityController.listActivity);

// 404
router.use((req, res) =>
  res.status(404).render('pages/error', { title: '404 — LEDGR', message: 'Page not found.', code: 404 })
);

module.exports = router;
