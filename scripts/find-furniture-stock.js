/**
 * Find Products with Variant Tags = "Furniture Stock"
 * Run: node scripts/find-furniture-stock.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const config = {
  url: process.env.ODOO_URL,
  db: process.env.ODOO_DB,
  uid: parseInt(process.env.ODOO_UID, 10),
  apikey: process.env.ODOO_APIKEY,
};

async function callOdoo(model, method, domain, fields, kwargs = {}) {
  const response = await axios.post(
    config.url,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [config.db, config.uid, config.apikey, model, method, [domain], { fields, ...kwargs }],
      },
      id: Math.floor(Math.random() * 1000),
    },
    { timeout: 30000 }
  );
  
  if (response.data.error) {
    throw new Error(response.data.error.data?.message || response.data.error.message);
  }
  
  return response.data.result;
}

console.log('═'.repeat(60));
console.log('🔍 PRODUCTS WITH VARIANT TAG "Furniture Stock"');
console.log('═'.repeat(60));

try {
  // Step 1: Get the Furniture Stock tag
  console.log('\n📋 Step 1: Get "Furniture Stock" tag...');
  const tags = await callOdoo(
    'product.tag',
    'search_read',
    [['name', '=', 'Furniture Stock']],
    ['id', 'name']
  );
  
  if (tags.length === 0) {
    console.log('❌ Tag "Furniture Stock" not found');
    process.exit(1);
  }
  
  const tagId = tags[0].id;
  console.log(`✅ Tag found: "${tags[0].name}" (ID: ${tagId})`);
  
  // Step 2: Find products using all_product_tag_ids (correct field for tag search)
  console.log('\n📋 Step 2: Finding products with Furniture Stock tag...');
  
  const products = await callOdoo(
    'product.product',
    'search_read',
    [['all_product_tag_ids', 'in', [tagId]]],
    ['id', 'name', 'default_code', 'product_tmpl_id']
  );
  
  console.log(`\n✅ Found ${products.length} product(s) with "Furniture Stock" tag:`);
  console.log('-'.repeat(60));
  
  products.forEach((product, i) => {
    console.log(`\n${i + 1}. ${product.name}`);
    console.log(`   ID: ${product.id}`);
    console.log(`   Default Code: ${product.default_code || 'N/A'}`);
    console.log(`   Template: ${product.product_tmpl_id?.[1] || 'N/A'}`);
  });
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total products with "Furniture Stock" tag: ${products.length}`);
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
