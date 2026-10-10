require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

// Base module schemas, applied in dependency order.
const BASE_FILES = [
  ['schema.sql', 'Schema'],
  ['inventory.sql', 'Inventory schema'],
  ['sales.sql', 'Sales & POS schema'],
  ['quotations.sql', 'Quotations schema'],
];

// Incremental migrations: any file named like "01_description.sql", run in numeric order.
// Every migration must be idempotent (IF NOT EXISTS, etc.) since all files run on each invocation.
const numberedFiles = () =>
  fs.readdirSync(__dirname)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running LEDGR database migrations...');
    for (const [file, label] of BASE_FILES) {
      await client.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      console.log(`✅ ${label} migration complete`);
    }
    for (const file of numberedFiles()) {
      await client.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      console.log(`✅ ${file} applied`);
    }
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
