const { query, getClient } = require('../../config/database');
const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('../utils/audit');

const listItems = async (req, res) => {
  const { search, category } = req.query;
  const businessId = req.user.business_id;

  try {
    // Check if business has any inventory_categories. If not, auto-seed default categories
    const catCheck = await query('SELECT 1 FROM inventory_categories WHERE business_id = $1 LIMIT 1', [businessId]);
    if (catCheck.rowCount === 0) {
      const defaultCategories = [
        'Clothing & Apparel', 'Electronics', 'Food & Beverage',
        'Accessories', 'Home & Living', 'Health & Beauty',
        'Stationery', 'Other'
      ];
      
      const insertQueries = defaultCategories.map(name => 
        query(
          'INSERT INTO inventory_categories (id, business_id, name) VALUES ($1, $2, $3)',
          [uuidv4(), businessId, name]
        )
      );
      await Promise.all(insertQueries);
    }

    let itemsQuery = `
      SELECT i.*, c.name AS category_name 
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.category_id
      WHERE i.business_id = $1
    `;
    const queryParams = [businessId];
    let paramIndex = 2;

    if (search) {
      itemsQuery += ` AND (i.name ILIKE $${paramIndex} OR i.sku ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      itemsQuery += ` AND i.category_id = $${paramIndex}`;
      queryParams.push(category);
      paramIndex++;
    }
    
    itemsQuery += ` ORDER BY i.created_at DESC`;

    const [items, categories, summary] = await Promise.all([
      query(itemsQuery, queryParams),
      query('SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name', [businessId]),
      query(
        `SELECT 
          COUNT(id) AS total_items,
          COALESCE(SUM(quantity * cost_price), 0) AS total_stock_value,
          COUNT(id) FILTER (WHERE quantity > 0 AND quantity <= reorder_level) AS low_stock_count,
          COUNT(id) FILTER (WHERE quantity = 0) AS out_of_stock_count
         FROM inventory_items 
         WHERE business_id = $1`,
        [businessId]
      )
    ]);

    res.render('pages/inventory/index', {
      title: 'Inventory — LEDGR',
      items: items.rows,
      categories: categories.rows,
      summary: summary.rows[0],
      filters: { search, category }
    });

  } catch (err) {
    console.error('Inventory list error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load inventory.', code: 500 });
  }
};

const showNewForm = async (req, res) => {
  try {
    const categories = await query(
      'SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name',
      [req.user.business_id]
    );
    res.render('pages/inventory/form', {
      title: 'Add Inventory Item — LEDGR',
      item: null, 
      error: null,
      categories: categories.rows
    });
  } catch (err) {
    console.error('Show new form error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load form.', code: 500 });
  }
};

const createItem = async (req, res) => {
  const errors = validationResult(req);
  const businessId = req.user.business_id;
  
  if (!errors.isEmpty()) {
    const categories = await query('SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name', [businessId]);
    return res.render('pages/inventory/form', {
      title: 'Add Inventory Item — LEDGR', 
      item: req.body,
      error: errors.array()[0].msg, 
      categories: categories.rows
    });
  }

  const { name, sku, categoryId, description, quantity, costPrice, sellPrice, currency, reorderLevel, supplier, location } = req.body;
  const itemId = uuidv4();
  const parsedQuantity = parseInt(quantity, 10) || 0;

  try {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      await client.query(
        `INSERT INTO inventory_items (id, business_id, category_id, name, sku, description, quantity, cost_price, sell_price, currency, reorder_level, supplier, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          itemId, businessId, categoryId || null, name, sku || null, description || null, 
          parsedQuantity, parseFloat(costPrice) || 0, parseFloat(sellPrice) || 0, currency || 'KES', 
          parseInt(reorderLevel, 10) || 5, supplier || null, location || null
        ]
      );

      if (parsedQuantity > 0) {
        await client.query(
          `INSERT INTO inventory_transactions (id, business_id, item_id, recorded_by, type, quantity_change, quantity_after, notes)
           VALUES ($1, $2, $3, $4, 'restock', $5, $6, 'Initial stock')`,
          [uuidv4(), businessId, itemId, req.user.id, parsedQuantity, parsedQuantity]
        );
      }

      await logAudit(req, {
        action: 'inventory.create', entityType: 'inventory_item', entityId: itemId, client,
        newValues: { name, sku, quantity: parsedQuantity, costPrice, sellPrice },
      });
      await client.query('COMMIT');
      res.redirect('/inventory?success=1');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create item error:', err);
    // handle unique constraint violation for SKU
    if (err.code === '23505') {
       const categories = await query('SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name', [businessId]);
       return res.render('pages/inventory/form', {
         title: 'Add Inventory Item — LEDGR', 
         item: req.body,
         error: 'An item with this SKU already exists.', 
         categories: categories.rows
       });
    }
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to create item.', code: 500 });
  }
};

const showItem = async (req, res) => {
  const businessId = req.user.business_id;
  try {
    const itemResult = await query(
      `SELECT i.*, c.name AS category_name 
       FROM inventory_items i
       LEFT JOIN inventory_categories c ON c.id = i.category_id
       WHERE i.id = $1 AND i.business_id = $2`,
      [req.params.id, businessId]
    );

    if (itemResult.rowCount === 0) {
      return res.status(404).render('pages/error', { title: 'Not Found — LEDGR', message: 'Item not found.', code: 404 });
    }

    const transactionsResult = await query(
      `SELECT t.*, u.first_name AS recorded_by_name
       FROM inventory_transactions t
       LEFT JOIN users u ON u.id = t.recorded_by
       WHERE t.item_id = $1 AND t.business_id = $2
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.params.id, businessId]
    );

    res.render('pages/inventory/show', {
      title: `${itemResult.rows[0].name} — LEDGR`,
      item: itemResult.rows[0],
      transactions: transactionsResult.rows
    });
  } catch (err) {
    console.error('Show item error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load item.', code: 500 });
  }
};

const showEditForm = async (req, res) => {
  const businessId = req.user.business_id;
  try {
    const itemResult = await query('SELECT * FROM inventory_items WHERE id = $1 AND business_id = $2', [req.params.id, businessId]);
    if (itemResult.rowCount === 0) {
      return res.status(404).render('pages/error', { title: 'Not Found — LEDGR', message: 'Item not found.', code: 404 });
    }
    
    const categories = await query('SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name', [businessId]);
    
    res.render('pages/inventory/form', {
      title: 'Edit Inventory Item — LEDGR',
      item: itemResult.rows[0],
      error: null,
      categories: categories.rows
    });
  } catch (err) {
    console.error('Show edit form error:', err);
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to load form.', code: 500 });
  }
};

const updateItem = async (req, res) => {
  const errors = validationResult(req);
  const businessId = req.user.business_id;
  
  if (!errors.isEmpty()) {
    const categories = await query('SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name', [businessId]);
    return res.render('pages/inventory/form', {
      title: 'Edit Inventory Item — LEDGR', 
      item: { ...req.body, id: req.params.id },
      error: errors.array()[0].msg, 
      categories: categories.rows
    });
  }

  const { name, sku, categoryId, description, costPrice, sellPrice, currency, reorderLevel, supplier, location } = req.body;
  
  try {
    const before = await query('SELECT * FROM inventory_items WHERE id = $1 AND business_id = $2', [req.params.id, businessId]);
    const after = await query(
      `UPDATE inventory_items 
       SET name = $1, sku = $2, category_id = $3, description = $4, cost_price = $5, sell_price = $6, 
           currency = $7, reorder_level = $8, supplier = $9, location = $10, updated_at = NOW()
       WHERE id = $11 AND business_id = $12 RETURNING *`,
      [
        name, sku || null, categoryId || null, description || null, parseFloat(costPrice) || 0, parseFloat(sellPrice) || 0,
        currency || 'KES', parseInt(reorderLevel, 10) || 5, supplier || null, location || null,
        req.params.id, businessId
      ]
    );
    if (after.rows.length) {
      await logAudit(req, {
        action: 'inventory.update', entityType: 'inventory_item', entityId: req.params.id,
        oldValues: before.rows[0], newValues: after.rows[0],
      });
    }
    res.redirect(`/inventory/${req.params.id}?updated=1`);
  } catch (err) {
    console.error('Update item error:', err);
    if (err.code === '23505') {
       const categories = await query('SELECT id, name FROM inventory_categories WHERE business_id = $1 ORDER BY name', [businessId]);
       return res.render('pages/inventory/form', {
         title: 'Edit Inventory Item — LEDGR', 
         item: { ...req.body, id: req.params.id },
         error: 'An item with this SKU already exists.', 
         categories: categories.rows
       });
    }
    res.status(500).render('pages/error', { title: 'Error — LEDGR', message: 'Failed to update item.', code: 500 });
  }
};

const deleteItem = async (req, res) => {
  try {
    await query('DELETE FROM inventory_items WHERE id = $1 AND business_id = $2', [req.params.id, req.user.business_id]);
    res.redirect('/inventory?deleted=1');
  } catch (err) {
    console.error('Delete item error:', err);
    res.redirect('/inventory?error=delete_failed');
  }
};

const adjustStock = async (req, res) => {
  const businessId = req.user.business_id;
  const itemId = req.params.id;
  const { type, quantity, reference, notes } = req.body;
  
  const parsedQuantity = Math.abs(parseInt(quantity, 10) || 0);
  if (parsedQuantity === 0) {
    return res.redirect(`/inventory/${itemId}?error=invalid_quantity`);
  }

  let quantityChange = parsedQuantity;
  if (['sale', 'damage', 'adjustment'].includes(type)) {
    quantityChange = -parsedQuantity;
  }

  try {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      const itemResult = await client.query(
        'SELECT quantity FROM inventory_items WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [itemId, businessId]
      );
      
      if (itemResult.rowCount === 0) {
        throw new Error('Item not found');
      }
      
      const currentQuantity = itemResult.rows[0].quantity;
      const quantityAfter = currentQuantity + quantityChange;

      await client.query(
        'UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2',
        [quantityAfter, itemId]
      );

      await client.query(
        `INSERT INTO inventory_transactions (id, business_id, item_id, recorded_by, type, quantity_change, quantity_after, reference, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [uuidv4(), businessId, itemId, req.user.id, type, quantityChange, quantityAfter, reference || null, notes || null]
      );

      await logAudit(req, {
        action: 'inventory.adjust', entityType: 'inventory_item', entityId: itemId, client,
        oldValues: { quantity: currentQuantity },
        newValues: { quantity: quantityAfter, type, quantityChange, reference: reference || null, notes: notes || null },
      });
      await client.query('COMMIT');
      res.redirect(`/inventory/${itemId}?adjusted=1`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Adjust stock error:', err);
    res.redirect(`/inventory/${itemId}?error=adjustment_failed`);
  }
};

module.exports = {
  listItems,
  showNewForm,
  createItem,
  showItem,
  showEditForm,
  updateItem,
  deleteItem,
  adjustStock
};
