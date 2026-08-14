require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running LEDGR database migrations...');
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSQL);
    console.log('✅ Schema migration complete');

    const inventorySQL = fs.readFileSync(path.join(__dirname, 'inventory.sql'), 'utf8');
    await client.query(inventorySQL);
    console.log('✅ Inventory schema migration complete');

    const salesSQL = fs.readFileSync(path.join(__dirname, 'sales.sql'), 'utf8');
    await client.query(salesSQL);
    console.log('✅ Sales & POS schema migration complete');

    const quotationsSQL = fs.readFileSync(path.join(__dirname, 'quotations.sql'), 'utf8');
    await client.query(quotationsSQL);
    console.log('✅ Quotations schema migration complete');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
