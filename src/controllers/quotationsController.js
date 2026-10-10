const { query, getClient } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('../utils/audit');
const { postIncome } = require('../utils/ledger');

// ── INTERNAL DASHBOARD VIEWS ─────────────────────────────────────────────────

const listQuotations = async (req, res) => {
  const businessId = req.user.business_id;
  try {
    const result = await query(
      `SELECT q.*, c.name AS customer_name_linked 
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE q.business_id = $1
       ORDER BY q.created_at DESC`,
      [businessId]
    );

    res.render('pages/quotations/index', {
      title: 'Quotations & Estimates — LEDGR',
      quotations: result.rows,
      user: req.user
    });
  } catch (err) {
    console.error('Error listing quotations:', err);
    res.status(500).render('pages/error', { title: 'Error', message: 'Failed to load quotations', code: 500 });
  }
};

const showForm = async (req, res) => {
  const businessId = req.user.business_id;
  try {
    // Fetch customers for the dropdown
    const customersResult = await query('SELECT id, name, email FROM customers WHERE business_id = $1 ORDER BY name ASC', [businessId]);
    
    // Fetch inventory items if POS is enabled
    let inventoryItems = [];
    if (req.user.has_pos) {
      const itemsResult = await query('SELECT id, name, sell_price FROM inventory_items WHERE business_id = $1 AND is_active = true', [businessId]);
      inventoryItems = itemsResult.rows;
    }

    let quotation = null;
    let items = [];

    if (req.params.id) {
      const qResult = await query('SELECT * FROM quotations WHERE id = $1 AND business_id = $2', [req.params.id, businessId]);
      if (qResult.rowCount > 0) {
        quotation = qResult.rows[0];
        const iResult = await query('SELECT * FROM quotation_items WHERE quotation_id = $1', [quotation.id]);
        items = iResult.rows;
      }
    }

    res.render('pages/quotations/form', {
      title: quotation ? 'Edit Quotation — LEDGR' : 'New Quotation — LEDGR',
      quotation,
      items,
      customers: customersResult.rows,
      inventoryItems,
      user: req.user
    });
  } catch (err) {
    console.error('Error showing quotation form:', err);
    res.status(500).render('pages/error', { title: 'Error', message: 'Failed to load form', code: 500 });
  }
};

const viewQuotation = async (req, res) => {
  const businessId = req.user.business_id;
  try {
    const qResult = await query(
      `SELECT q.*, c.name AS customer_name_linked, b.name AS business_name, b.email AS business_email, b.phone AS business_phone
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       JOIN businesses b ON b.id = q.business_id
       WHERE q.id = $1 AND q.business_id = $2`,
      [req.params.id, businessId]
    );

    if (qResult.rowCount === 0) return res.status(404).render('pages/error', { title: 'Not Found', message: 'Quotation not found', code: 404 });
    const quotation = qResult.rows[0];

    const iResult = await query('SELECT * FROM quotation_items WHERE quotation_id = $1', [quotation.id]);
    
    // Generate full public URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const publicUrl = `${protocol}://${host}/q/${quotation.public_token}`;

    res.render('pages/quotations/show', {
      title: `Quote ${quotation.quote_number} — LEDGR`,
      quotation,
      items: iResult.rows,
      publicUrl,
      user: req.user
    });
  } catch (err) {
    console.error('Error viewing quotation:', err);
    res.status(500).render('pages/error', { title: 'Error', message: 'Failed to load quotation', code: 500 });
  }
};

// ── API ENDPOINTS ────────────────────────────────────────────────────────────

const saveQuotationAPI = async (req, res) => {
  const businessId = req.user.business_id;
  const { id, customerId, customerName, customerEmail, validUntil, notes, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Quotation must have at least one item' });
  }

  const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Linked inventory items must belong to this business
    const linkedIds = [...new Set(items.map(i => i.itemId).filter(Boolean))];
    if (linkedIds.length) {
      const owned = await client.query(
        'SELECT id FROM inventory_items WHERE business_id = $1 AND id = ANY($2::uuid[])',
        [businessId, linkedIds]
      );
      if (owned.rowCount !== linkedIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more items were not found in your inventory' });
      }
    }

    let quotationId = id;
    if (id) {
      // Update existing
      const updated = await client.query(
        `UPDATE quotations SET 
          customer_id = $1, customer_name = $2, customer_email = $3, 
          total_amount = $4, valid_until = $5, notes = $6, updated_at = NOW()
         WHERE id = $7 AND business_id = $8 AND status IN ('draft', 'sent')`,
        [customerId || null, customerName, customerEmail, totalAmount, validUntil || null, notes, id, businessId]
      );
      // Not ours, or already accepted/converted: leave its items untouched
      if (updated.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Quotation not found or can no longer be edited' });
      }
      // Replace items
      await client.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [id]);
    } else {
      // Create new
      quotationId = uuidv4();
      const quoteNumber = 'EST-' + Math.random().toString(36).substr(2, 6).toUpperCase();
      const publicToken = require('crypto').randomBytes(16).toString('hex');

      await client.query(
        `INSERT INTO quotations (id, business_id, customer_id, customer_name, customer_email, quote_number, total_amount, valid_until, public_token, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')`,
        [quotationId, businessId, customerId || null, customerName, customerEmail, quoteNumber, totalAmount, validUntil || null, publicToken, notes]
      );
    }

    await logAudit(req, {
      action: id ? 'quotation.update' : 'quotation.create', entityType: 'quotation', entityId: quotationId, client,
      newValues: { customerName, customerEmail, totalAmount, validUntil, itemCount: items.length },
    });

    // Insert new items
    for (const item of items) {
      await client.query(
        `INSERT INTO quotation_items (id, quotation_id, item_id, description, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuidv4(), quotationId, item.itemId || null, item.description, item.quantity, item.unitPrice, item.quantity * item.unitPrice]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, quotationId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Save quote error:', err);
    res.status(500).json({ error: 'Failed to save quotation' });
  } finally {
    client.release();
  }
};

const updateStatusAPI = async (req, res) => {
  const businessId = req.user.business_id;
  const { status } = req.body;
  try {
    const before = await query('SELECT status FROM quotations WHERE id = $1 AND business_id = $2', [req.params.id, businessId]);
    await query(`UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3`, [status, req.params.id, businessId]);
    if (before.rows.length) {
      await logAudit(req, {
        action: 'quotation.status', entityType: 'quotation', entityId: req.params.id,
        oldValues: { status: before.rows[0].status }, newValues: { status },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
};

const convertToSaleAPI = async (req, res) => {
  const businessId = req.user.business_id;
  const userId = req.user.id;
  const quotationId = req.params.id;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Get Quotation
    const qResult = await client.query('SELECT * FROM quotations WHERE id = $1 AND business_id = $2 FOR UPDATE', [quotationId, businessId]);
    if (qResult.rowCount === 0) throw new Error('Quotation not found');
    const quote = qResult.rows[0];

    if (quote.status === 'converted') throw new Error('Quotation already converted');
    if (quote.status !== 'accepted') throw new Error('Quotation must be accepted before converting');

    // 2. Create Sale
    const saleId = uuidv4();
    const receiptNumber = 'INV-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    
    // Auto-create customer if missing but we have details
    let finalCustomerId = quote.customer_id;
    if (!finalCustomerId && quote.customer_name) {
      finalCustomerId = uuidv4();
      await client.query(
        `INSERT INTO customers (id, business_id, name, email) VALUES ($1, $2, $3, $4)`,
        [finalCustomerId, businessId, quote.customer_name, quote.customer_email]
      );
    }

    await client.query(
      `INSERT INTO sales (id, business_id, customer_id, recorded_by, receipt_number, total_amount, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'bank_transfer', 'completed')`,
      [saleId, businessId, finalCustomerId, userId, receiptNumber, quote.total_amount]
    );

    // 3. Process Items & Inventory
    const iResult = await client.query('SELECT * FROM quotation_items WHERE quotation_id = $1', [quotationId]);
    for (const item of iResult.rows) {
      await client.query(
        `INSERT INTO sale_items (id, sale_id, item_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), saleId, item.item_id, item.quantity, item.unit_price, item.subtotal]
      );

      // If linked to inventory, deduct stock
      if (item.item_id) {
        const invResult = await client.query('SELECT quantity FROM inventory_items WHERE id = $1 AND business_id = $2 FOR UPDATE', [item.item_id, businessId]);
        if (invResult.rowCount > 0) {
          const currentQty = invResult.rows[0].quantity;
          const newQty = currentQty - item.quantity;
          await client.query(`UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2`, [newQty, item.item_id]);
          await client.query(
            `INSERT INTO inventory_transactions (id, business_id, item_id, recorded_by, type, quantity_change, quantity_after, reference, notes)
             VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, 'Converted from Quote')`,
            [uuidv4(), businessId, item.item_id, userId, -item.quantity, newQty, receiptNumber]
          );
        }
      }
    }

    // 4. Record income and post it to the ledger
    const income = await client.query(
      `INSERT INTO income_records (id, business_id, recorded_by, date, amount, source, description, payment_mode, is_verified)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'invoice', $5, 'bank_transfer', true) RETURNING *`,
      [uuidv4(), businessId, userId, quote.total_amount, `Converted Quote ${quote.quote_number}`]
    );
    await postIncome(client, income.rows[0], userId);

    // 5. Update quote status
    await client.query(`UPDATE quotations SET status = 'converted', updated_at = NOW() WHERE id = $1`, [quotationId]);
    await logAudit(req, {
      action: 'quotation.convert', entityType: 'quotation', entityId: quotationId, client,
      oldValues: { status: quote.status }, newValues: { status: 'converted', saleId, receiptNumber, total: quote.total_amount },
    });

    await client.query('COMMIT');
    res.json({ success: true, saleId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Convert to sale error:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};


// ── PUBLIC FACING ENDPOINTS ──────────────────────────────────────────────────

const publicQuoteView = async (req, res) => {
  try {
    const qResult = await query(
      `SELECT q.*, c.name AS customer_name_linked, b.name AS business_name, b.email AS business_email, b.phone AS business_phone, b.logo_url, b.currency
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       JOIN businesses b ON b.id = q.business_id
       WHERE q.public_token = $1`,
      [req.params.token]
    );

    if (qResult.rowCount === 0) return res.status(404).send('Quotation not found');
    const quotation = qResult.rows[0];
    const iResult = await query('SELECT * FROM quotation_items WHERE quotation_id = $1', [quotation.id]);

    res.render('pages/public/quotation', {
      title: `Estimate ${quotation.quote_number} from ${quotation.business_name}`,
      quotation,
      items: iResult.rows
    });
  } catch (err) {
    console.error('Public quote error:', err);
    res.status(500).send('Error loading quotation');
  }
};

const publicQuoteAction = async (req, res) => {
  const { action } = req.body; // 'accept' or 'reject'
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  try {
    const result = await query(
      `UPDATE quotations SET status = $1, updated_at = NOW() 
       WHERE public_token = $2 AND status IN ('draft', 'sent') RETURNING id, business_id`,
      [action, req.params.token]
    );
    if (result.rowCount === 0) return res.status(400).json({ error: 'Quote cannot be modified' });
    await logAudit(req, {
      action: `quotation.customer_${action}`, entityType: 'quotation', entityId: result.rows[0].id,
      newValues: { status: action, via: 'public_link' }, businessId: result.rows[0].business_id, userId: null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update quote' });
  }
};

module.exports = {
  listQuotations,
  showForm,
  viewQuotation,
  saveQuotationAPI,
  updateStatusAPI,
  convertToSaleAPI,
  publicQuoteView,
  publicQuoteAction
};
