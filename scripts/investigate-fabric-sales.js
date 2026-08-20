/**
 * Script điều tra dữ liệu bán vải trong Odoo
 * Phân tích logic tính toán hiển thị số lượng bán và doanh số
 */
import axios from 'axios'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const config = {
  url: process.env.ODOO_URL,
  db: process.env.ODOO_DB,
  uid: parseInt(process.env.ODOO_UID),
  apikey: process.env.ODOO_APIKEY,
}

console.log('Config:', { url: config.url, db: config.db, uid: config.uid })

async function odoo(model, method, domain, fields, kwargs = {}) {
  const response = await axios.post(config.url, {
    jsonrpc: '2.0', method: 'call', id: Math.random(),
    params: {
      service: 'object', method: 'execute_kw',
      args: [config.db, config.uid, config.apikey, model, method, [domain], { fields, ...kwargs }]
    }
  }, { timeout: 30000 })
  if (response.data.error) throw new Error(JSON.stringify(response.data.error.data?.message || response.data.error))
  return response.data.result
}

async function main() {
  // 1. Tìm tag "Stock fabrics"
  console.log('\n=== 1. PRODUCT TAGS ===')
  const tags = await odoo('product.tag', 'search_read', [], ['id', 'name'], { limit: 50 })
  console.log('Tags:', tags)

  const fabricTag = tags.find(t => t.name === 'Stock fabrics')
  if (!fabricTag) { console.error('Không tìm thấy tag Stock fabrics'); return }
  console.log('Stock fabrics tag ID:', fabricTag.id)

  // 2. Lấy sản phẩm với tag này
  console.log('\n=== 2. PRODUCTS WITH TAG "Stock fabrics" ===')
  const products = await odoo('product.product', 'search_read',
    [['all_product_tag_ids', 'in', [fabricTag.id]]],
    ['id', 'name', 'default_code', 'uom_id', 'product_tmpl_id', 'product_template_attribute_value_ids'],
    { limit: 200 }
  )
  console.log(`Total products with tag: ${products.length}`)
  
  // Lấy unique UOMs để hiểu đơn vị đo
  const uomIds = [...new Set(products.map(p => p.uom_id?.[0]).filter(Boolean))]
  console.log('UOM IDs found on products:', uomIds)
  
  // Sample 5 sản phẩm đầu
  console.log('Sample products:')
  products.slice(0, 5).forEach(p => {
    console.log(`  - [${p.id}] ${p.name} | Code: ${p.default_code} | UOM: ${JSON.stringify(p.uom_id)}`)
  })

  const productIds = products.map(p => p.id)

  // 3. Lấy sale order lines cho các sản phẩm này
  console.log('\n=== 3. SALE ORDER LINES - Sample 20 lines ===')
  const saleLines = await odoo('sale.order.line', 'search_read',
    [
      ['product_id', 'in', productIds],
      ['state', '=', 'sale'],
    ],
    ['id', 'product_id', 'product_uom_qty', 'price_subtotal', 'price_unit', 'product_uom', 'state', 'order_id', 'qty_delivered', 'qty_invoiced', 'discount'],
    { limit: 20, order: 'id desc' }
  )
  console.log(`Found ${saleLines.length} sale lines (sample 20)`)
  saleLines.forEach(l => {
    console.log(`  Line ${l.id}: product=${l.product_id?.[1]}, qty=${l.product_uom_qty}, uom=${JSON.stringify(l.product_uom)}, subtotal=${l.price_subtotal}, delivered=${l.qty_delivered}, state=${l.state}, discount=${l.discount}%`)
  })

  // 4. Kiểm tra có order nào bị cancel không nhưng line vẫn state=sale
  console.log('\n=== 4. CHECK CANCELLED ORDERS WITH SALE LINES ===')
  const cancelledOrders = await odoo('sale.order', 'search_read',
    [['state', '=', 'cancel']],
    ['id', 'name', 'state'],
    { limit: 5 }
  )
  console.log('Sample cancelled orders:', cancelledOrders.length)

  if (cancelledOrders.length > 0) {
    const cancelledOrderIds = cancelledOrders.map(o => o.id)
    const linesInCancelled = await odoo('sale.order.line', 'search_read',
      [['order_id', 'in', cancelledOrderIds], ['product_id', 'in', productIds]],
      ['id', 'state', 'product_uom_qty', 'product_id', 'order_id'],
      { limit: 10 }
    )
    console.log('Lines in cancelled orders:', linesInCancelled.length)
    linesInCancelled.slice(0, 3).forEach(l => {
      console.log(`  Line ${l.id}: state=${l.state}, order=${JSON.stringify(l.order_id)}, product=${l.product_id?.[1]}, qty=${l.product_uom_qty}`)
    })
  }

  // 5. Kiểm tra UOM của các sale order lines
  console.log('\n=== 5. UOM DISTRIBUTION ON SALE LINES ===')
  const allSaleLines = await odoo('sale.order.line', 'search_read',
    [
      ['product_id', 'in', productIds],
      ['state', '=', 'sale'],
    ],
    ['id', 'product_uom', 'product_uom_qty', 'price_subtotal'],
    { limit: 500 }
  )
  
  const uomDistribution = {}
  allSaleLines.forEach(l => {
    const uomName = l.product_uom?.[1] || 'Unknown'
    if (!uomDistribution[uomName]) uomDistribution[uomName] = { count: 0, totalQty: 0, totalRevenue: 0 }
    uomDistribution[uomName].count++
    uomDistribution[uomName].totalQty += l.product_uom_qty || 0
    uomDistribution[uomName].totalRevenue += l.price_subtotal || 0
  })
  
  console.log('UOM distribution on sale lines:')
  Object.entries(uomDistribution).forEach(([uom, data]) => {
    console.log(`  ${uom}: ${data.count} lines, qty=${data.totalQty.toFixed(2)}, revenue=${data.totalRevenue.toFixed(0)} VND`)
  })

  // 6. Kiểm tra product UOM trên template
  console.log('\n=== 6. PRODUCT TEMPLATE UOM ===')
  const tmplIds = [...new Set(products.map(p => p.product_tmpl_id?.[0]).filter(Boolean))]
  const templates = await odoo('product.template', 'search_read',
    [['id', 'in', tmplIds]],
    ['id', 'name', 'uom_id', 'uom_po_id'],
    { limit: 50 }
  )
  
  const tmplUomDistrib = {}
  templates.forEach(t => {
    const uom = t.uom_id?.[1] || 'Unknown'
    if (!tmplUomDistrib[uom]) tmplUomDistrib[uom] = 0
    tmplUomDistrib[uom]++
  })
  console.log('Product template UOM distribution:', tmplUomDistrib)
  
  // Show templates with non-meter UOM
  const nonMeterTemplates = templates.filter(t => !['m', 'Mét', 'meter', 'Meter'].some(u => t.uom_id?.[1]?.toLowerCase().includes(u.toLowerCase())))
  console.log(`Templates with non-meter UOM: ${nonMeterTemplates.length}`)
  nonMeterTemplates.slice(0, 5).forEach(t => {
    console.log(`  [${t.id}] ${t.name} | UOM: ${JSON.stringify(t.uom_id)}`)
  })

  // 7. Kiểm tra xem có sale lines nào với order_id.state != 'sale' bị lọt vào không
  console.log('\n=== 7. VERIFY: sale.order.line state vs order state ===')
  // Lấy 30 lines và check order state
  const sampleLines = await odoo('sale.order.line', 'search_read',
    [['product_id', 'in', productIds.slice(0, 10)], ['state', '=', 'sale']],
    ['id', 'order_id', 'product_uom_qty', 'product_uom', 'price_subtotal'],
    { limit: 30 }
  )
  
  const sampleOrderIds = [...new Set(sampleLines.map(l => l.order_id?.[0]).filter(Boolean))]
  if (sampleOrderIds.length > 0) {
    const sampleOrders = await odoo('sale.order', 'search_read',
      [['id', 'in', sampleOrderIds]],
      ['id', 'name', 'state', 'date_order'],
      { limit: 50 }
    )
    
    const orderStateMap = {}
    sampleOrders.forEach(o => { orderStateMap[o.id] = o.state })
    
    const mismatch = sampleLines.filter(l => {
      const orderState = orderStateMap[l.order_id?.[0]]
      return orderState && orderState !== 'sale'
    })
    
    console.log(`Lines where line.state='sale' but order.state != 'sale': ${mismatch.length}`)
    mismatch.slice(0, 5).forEach(l => {
      const orderState = orderStateMap[l.order_id?.[0]]
      console.log(`  Line ${l.id}: order=${l.order_id?.[1]} (state=${orderState}), qty=${l.product_uom_qty}`)
    })
  }

  // 8. Tổng hợp doanh số thực tế - so sánh cách tính cũ vs mới
  console.log('\n=== 8. TOTAL SUMMARY: Tổng hợp doanh số "Stock fabrics" ===')
  
  // Cách hiện tại: state=sale + order_id.state=sale, dùng product_uom_qty
  const currentMethodLines = await odoo('sale.order.line', 'search_read',
    [
      ['product_id', 'in', productIds],
      ['state', '=', 'sale'],
      ['order_id.state', '=', 'sale'],
    ],
    ['id', 'product_id', 'product_uom_qty', 'qty_delivered', 'price_subtotal', 'product_uom'],
    { limit: 1000 }
  )
  
  const currentTotal = currentMethodLines.reduce((sum, l) => sum + (l.price_subtotal || 0), 0)
  const currentQty = currentMethodLines.reduce((sum, l) => sum + (l.product_uom_qty || 0), 0)
  
  // Chỉ lấy lines với UOM là mét
  const meterLines = currentMethodLines.filter(l => {
    const uomName = l.product_uom?.[1]?.toLowerCase() || ''
    return uomName.includes('m') || uomName.includes('mét') || uomName.includes('met')
  })
  const meterTotal = meterLines.reduce((sum, l) => sum + (l.price_subtotal || 0), 0)
  const meterQty = meterLines.reduce((sum, l) => sum + (l.product_uom_qty || 0), 0)
  
  // qty_delivered thay vì product_uom_qty
  const deliveredQty = currentMethodLines.reduce((sum, l) => sum + (l.qty_delivered || 0), 0)
  
  console.log(`Current method (product_uom_qty, all UOMs): ${currentMethodLines.length} lines, qty=${currentQty.toFixed(2)}, revenue=${currentTotal.toFixed(0)} VND`)
  console.log(`Meter-only lines: ${meterLines.length} lines, qty=${meterQty.toFixed(2)}, revenue=${meterTotal.toFixed(0)} VND`)
  console.log(`Using qty_delivered instead: deliveredQty=${deliveredQty.toFixed(2)}`)
  
  // 9. Kiểm tra các UOM khác (không phải mét) trong lines
  const nonMeterSaleLines = currentMethodLines.filter(l => {
    const uomName = l.product_uom?.[1]?.toLowerCase() || ''
    return !uomName.includes('m') && !uomName.includes('mét') && !uomName.includes('met')
  })
  console.log(`\nNon-meter UOM lines: ${nonMeterSaleLines.length}`)
  nonMeterSaleLines.slice(0, 10).forEach(l => {
    console.log(`  Line ${l.id}: product=${l.product_id?.[1]}, uom=${JSON.stringify(l.product_uom)}, qty=${l.product_uom_qty}, subtotal=${l.price_subtotal}`)
  })
}

main().catch(e => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
