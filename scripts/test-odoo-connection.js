/**
 * Odoo Connection Diagnostic Script
 * Run: node scripts/test-odoo-connection.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('═'.repeat(60));
console.log('🔍 ODOO CONNECTION DIAGNOSTIC TEST');
console.log('═'.repeat(60));

const config = {
  url: process.env.ODOO_URL,
  db: process.env.ODOO_DB,
  uid: process.env.ODOO_UID,
  apikey: process.env.ODOO_APIKEY,
};

console.log('\n📋 Configuration:');
console.log('  ODOO_URL:', config.url || '❌ MISSING');
console.log('  ODOO_DB:', config.db || '❌ MISSING');
console.log('  ODOO_UID:', config.uid || '❌ MISSING');
console.log('  ODOO_APIKEY:', config.apikey ? '✅ SET' : '❌ MISSING');

// Check for missing config
const missingConfig = [];
if (!config.url) missingConfig.push('ODOO_URL');
if (!config.db) missingConfig.push('ODOO_DB');
if (!config.uid) missingConfig.push('ODOO_UID');
if (!config.apikey) missingConfig.push('ODOO_APIKEY');

if (missingConfig.length > 0) {
  console.log('\n❌ CONFIGURATION ERROR:');
  console.log(`   Missing: ${missingConfig.join(', ')}`);
  console.log('\n💡 Solution: Update server/.env with correct values');
  process.exit(1);
}

// Test 1: Basic connectivity
console.log('\n📡 TEST 1: Basic Connectivity');
console.log('-'.repeat(40));

try {
  const response = await axios.post(
    config.url,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          config.db,
          parseInt(config.uid, 10),
          config.apikey,
          'res.company',
          'search_read',
          [[[ 'id', '=', 1]]],
          { fields: ['name', 'phone', 'street', 'city'] },
        ],
      },
      id: 1,
    },
    { timeout: 10000 }
  );

  if (response.data.error) {
    console.log('❌ Odoo returned error:');
    console.log('   Code:', response.data.error.code);
    console.log('   Message:', response.data.error.message);
    console.log('   Data:', JSON.stringify(response.data.error.data, null, 2));
  } else {
    console.log('✅ Basic connectivity: OK');
    console.log('   Response result:', JSON.stringify(response.data.result, null, 2));
  }
} catch (error) {
  console.log('❌ Connection failed:');
  console.log('   Error code:', error.code);
  console.log('   Error message:', error.message);
  
  if (error.code === 'ECONNREFUSED') {
    console.log('\n💡 The Odoo server is not accepting connections');
    console.log('   - Check if Odoo is running');
    console.log('   - Verify the ODOO_URL is correct');
  } else if (error.code === 'ENOTFOUND') {
    console.log('\n💡 Odoo server hostname not found');
    console.log('   - Check if the domain exists');
    console.log('   - Verify ODOO_URL is correct');
  } else if (error.code === 'ETIMEDOUT') {
    console.log('\n💡 Connection timed out');
    console.log('   - Check network connectivity');
    console.log('   - Verify Odoo server is accessible');
  }
}

// Test 2: stock.picking model access
console.log('\n📡 TEST 2: stock.picking Model Access');
console.log('-'.repeat(40));

try {
  const response = await axios.post(
    config.url,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          config.db,
          parseInt(config.uid, 10),
          config.apikey,
          'stock.picking',
          'search_read',
          [[]],
          { fields: ['name', 'state'], limit: 3 },
        ],
      },
      id: 2,
    },
    { timeout: 15000 }
  );

  if (response.data.error) {
    console.log('❌ stock.picking access denied:');
    console.log('   Message:', response.data.error.data?.message || response.data.error.message);
    console.log('   Exception:', response.data.error.data?.exception_type);
  } else {
    const results = response.data.result;
    console.log('✅ stock.picking access: OK');
    console.log(`   Found ${results.length} pickings:`);
    results.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name} (${p.state})`);
    });
  }
} catch (error) {
  console.log('❌ stock.picking test failed:');
  console.log('   Error:', error.message);
}

// Test 3: stock.move model access
console.log('\n📡 TEST 3: stock.move Model Access');
console.log('-'.repeat(40));

try {
  const response = await axios.post(
    config.url,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          config.db,
          parseInt(config.uid, 10),
          config.apikey,
          'stock.move',
          'search_read',
          [[]],
          { fields: ['name', 'product_id', 'product_uom_qty'], limit: 3 },
        ],
      },
      id: 3,
    },
    { timeout: 15000 }
  );

  if (response.data.error) {
    console.log('❌ stock.move access denied:');
    console.log('   Message:', response.data.error.data?.message || response.data.error.message);
  } else {
    console.log('✅ stock.move access: OK');
    console.log(`   Found ${response.data.result.length} moves`);
  }
} catch (error) {
  console.log('❌ stock.move test failed:', error.message);
}

// Test 4: stock.move.line model access
console.log('\n📡 TEST 4: stock.move.line Model Access');
console.log('-'.repeat(40));

try {
  const response = await axios.post(
    config.url,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          config.db,
          parseInt(config.uid, 10),
          config.apikey,
          'stock.move.line',
          'search_read',
          [[]],
          { fields: ['product_id', 'lot_name', 'qty_done'], limit: 3 },
        ],
      },
      id: 4,
    },
    { timeout: 15000 }
  );

  if (response.data.error) {
    console.log('❌ stock.move.line access denied:');
    console.log('   Message:', response.data.error.data?.message || response.data.error.message);
  } else {
    console.log('✅ stock.move.line access: OK');
    console.log(`   Found ${response.data.result.length} move lines`);
  }
} catch (error) {
  console.log('❌ stock.move.line test failed:', error.message);
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('📊 SUMMARY');
console.log('═'.repeat(60));
console.log('\nIf all tests pass ✅, Odoo connection is working properly.');
console.log('If tests fail ❌, check the error messages above for details.');
console.log('\nCommon issues:');
console.log('  1. Invalid API key - Generate new key in Odoo > Settings > API Keys');
console.log('  2. Insufficient permissions - User needs stock.group_stock_user');
console.log('  3. Wrong database name - Match exactly with Odoo database');
console.log('  4. Network/firewall issues - Check if Odoo URL is accessible');
