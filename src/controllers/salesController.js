const { query, getClient } = require('../../config/database');
const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('../utils/audit');

// Render the historical sales page
const listSales = async (req, res) => {
  const businessId = req.user.business_id;

  try {
    const salesResult = await query(
      `SELECT s.*, u.first_name AS cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.recorded_by
       WHERE s.business_id = $1
       ORDER BY s.created_at DESC LIMIT 100`,
      [businessId]
    );

    const summaryResult = await query(
      `SELECT 
        COUNT(id) AS total_receipts,
        COALESCE(SUM(total_amount), 0) AS total_revenue
       FROM sales
       WHERE business_id = $1 AND DATE(created_at) = CURRENT_DATE AND status = 'completed'`,
      [businessId]
    );

    res.render('pages/sales/index', {
      title: 'Sales History — LEDGR',
      sales: salesResult.rows,
      summary: summaryResult.rows[0],
      user: req.user
    });
  } catch (err) {
    console.error('List sales error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load sales.', code: 500 });
  }
};

// Render the POS page
const showPOS = async (req, res) => {
  res.render('pages/sales/pos', {
    title: 'Point of Sale — LEDGR',
    user: req.user
  });
};

// API: Search Inventory for the POS
const searchItemsAPI = async (req, res) => {
  const businessId = req.user.business_id;
  const { q } = req.query;

  try {
    let sql = `SELECT id, name, sku, quantity, sell_price, currency, category_id 
               FROM inventory_items 
               WHERE business_id = $1 AND is_active = true`;
    const params = [businessId];

    if (q) {
      sql += ` AND (name ILIKE $2 OR sku ILIKE $2)`;
      params.push(`%${q}%`);
    }

    sql += ` ORDER BY name ASC LIMIT 50`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('API search items error:', err);
    res.status(500).json({ error: 'Failed to search items' });
  }
};

// API: Process Checkout
const checkoutAPI = async (req, res) => {
  const businessId = req.user.business_id;
  const userId = req.user.id;
  const { cart, paymentMethod, customerName, customerPhone, totalAmount } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  try {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 1. Check or create customer if provided
      let customerId = null;
      if (customerPhone) {
        // Try to find customer by phone
        const custResult = await client.query('SELECT id FROM customers WHERE business_id = $1 AND phone = $2', [businessId, customerPhone]);
        if (custResult.rowCount > 0) {
          customerId = custResult.rows[0].id;
        } else {
          customerId = uuidv4();
          await client.query(
            `INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, $3, $4)`,
            [customerId, businessId, customerName || 'Walk-in Customer', customerPhone]
          );
        }
      }

      // 2. Create the Sale record
      const saleId = uuidv4();
      const receiptNumber = 'REC-' + Math.random().toString(36).substr(2, 6).toUpperCase();
      
      await client.query(
        `INSERT INTO sales (id, business_id, customer_id, recorded_by, receipt_number, total_amount, payment_method, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')`,
        [saleId, businessId, customerId, userId, receiptNumber, totalAmount, paymentMethod]
      );

      // 3. Process each item
      for (const item of cart) {
        // Verify inventory
        const invResult = await client.query('SELECT quantity FROM inventory_items WHERE id = $1 AND business_id = $2 FOR UPDATE', [item.id, businessId]);
        if (invResult.rowCount === 0) {
          throw new Error(`Item ${item.name} not found`);
        }
        
        const currentQty = invResult.rows[0].quantity;
        if (currentQty < item.cartQuantity) {
          throw new Error(`Insufficient stock for ${item.name}. Available: ${currentQty}`);
        }

        const newQty = currentQty - item.cartQuantity;

        // Insert sale_item
        await client.query(
          `INSERT INTO sale_items (id, sale_id, item_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), saleId, item.id, item.cartQuantity, item.sell_price, item.cartQuantity * item.sell_price]
        );

        // Update inventory quantity
        await client.query(
          `UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2`,
          [newQty, item.id]
        );

        // Log transaction
        await client.query(
          `INSERT INTO inventory_transactions (id, business_id, item_id, recorded_by, type, quantity_change, quantity_after, reference, notes)
           VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, 'POS Sale')`,
          [uuidv4(), businessId, item.id, userId, -item.cartQuantity, newQty, receiptNumber]
        );
      }

      // 4. Record to income ledger
      await client.query(
        `INSERT INTO income_records (id, business_id, recorded_by, date, amount, source, description, payment_mode, receipt_url, is_verified)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, 'daily_sales', $5, $6, $7, true)`,
        [uuidv4(), businessId, userId, totalAmount, `POS Sale - ${receiptNumber}`, paymentMethod, `/sales/${saleId}/receipt`]
      );

      await logAudit(req, {
        action: 'sale.create', entityType: 'sale', entityId: saleId, client,
        newValues: {
          receiptNumber, totalAmount, paymentMethod, customerId,
          items: cart.map(i => ({ id: i.id, name: i.name, quantity: i.cartQuantity, price: i.sell_price })),
        },
      });
      await client.query('COMMIT');
      res.json({ success: true, saleId, receiptNumber });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(400).json({ error: err.message || 'Checkout failed' });
  }
};

// API: Get sale details for receipt printing
const showReceiptAPI = async (req, res) => {
  const businessId = req.user.business_id;
  try {
    const saleResult = await query(
      `SELECT s.*, u.first_name AS cashier, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s
       LEFT JOIN users u ON u.id = s.recorded_by
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = $1 AND s.business_id = $2`,
      [req.params.id, businessId]
    );

    if (saleResult.rowCount === 0) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    const itemsResult = await query(
      `SELECT si.*, i.name
       FROM sale_items si
       LEFT JOIN inventory_items i ON i.id = si.item_id
       WHERE si.sale_id = $1`,
      [req.params.id]
    );

    res.json({
      sale: saleResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    console.error('Show receipt error:', err);
    res.status(500).json({ error: 'Failed to load receipt' });
  }
};

module.exports = {
  listSales,
  showPOS,
  searchItemsAPI,
  checkoutAPI,
  showReceiptAPI
};
