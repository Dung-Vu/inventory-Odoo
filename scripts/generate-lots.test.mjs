import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLotPlan,
  collectSerialTargets,
  createAndAssignLot,
  normalizeLotSegment,
  resolveSubcontractAssignments,
  resolveSourceDocumentCode,
  slugifyProductName,
} from '../server/routes/generate-lots.js'

function fakeOdoo({ moveLines }) {
  return async (model) => {
    if (model === 'stock.move') {
      return [{ id: 501, product_id: [71, 'ORD-BED-NERISSA (W1800)'], product_uom_qty: 1, is_subcontract: true }]
    }
    if (model === 'stock.move.line') return moveLines
    if (model === 'product.product') {
      return [{ id: 71, name: 'ORD-BED-NERISSA (W1800)', tracking: 'serial', company_id: [1, 'Bonario'] }]
    }
    throw new Error(`Unexpected Odoo model: ${model}`)
  }
}

test('keeps subcontract receipt lines plannable for the source-MO-first workflow', async () => {
  const { products, blockingIssues } = await collectSerialTargets(16910, 1, fakeOdoo({
    moveLines: [{
      id: 901,
      product_id: [71, 'ORD-BED-NERISSA (W1800)'],
      move_id: [501, 'move'],
      quantity: 1,
      qty_done: 0,
      lot_id: false,
      lot_name: false,
    }],
  }))

  assert.equal(blockingIssues.length, 0)
  assert.equal(products[0].is_subcontract, true)
  assert.equal(products[0].need_lots, 1)
})

test('maps a subcontract Detail line to its matching source MO before assignment', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [{
        id: 3790,
        name: 'O-MID/SBC/00378',
        state: 'done',
        product_id: [71, 'ORD-BED-NERISSA (W1800)'],
        product_qty: 1,
        lot_producing_ids: [],
      }]
    }
    throw new Error(`Unexpected Odoo model: ${model}`)
  }
  const { byMoveLine, blockingIssues } = await resolveSubcontractAssignments(16910, [{
    product_id: 71,
    product_name: 'ORD-BED-NERISSA (W1800)',
    is_subcontract: true,
    plannable_lines: [{ id: 901, quantity: 1 }],
  }], call)

  assert.equal(blockingIssues.length, 0)
  assert.deepEqual(byMoveLine.get(901), {
    subcontract_mo_id: 3790,
    subcontract_mo_name: 'O-MID/SBC/00378',
    existing_lot_id: null,
    existing_lot_name: null,
  })
})

test('reuses an existing source-MO lot instead of creating another one', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [{
        id: 3790,
        name: 'O-MID/SBC/00378',
        state: 'done',
        product_id: [71, 'ORD-BED-NERISSA (W1800)'],
        product_qty: 1,
        lot_producing_ids: [780],
      }]
    }
    if (model === 'stock.lot') return [{ id: 780, name: 'O-MH08966-BED-NERISSA-001' }]
    throw new Error(`Unexpected Odoo model: ${model}`)
  }
  const { byMoveLine, blockingIssues } = await resolveSubcontractAssignments(16910, [{
    product_id: 71,
    product_name: 'ORD-BED-NERISSA (W1800)',
    is_subcontract: true,
    plannable_lines: [{ id: 901, quantity: 1 }],
  }], call)

  assert.equal(blockingIssues.length, 0)
  assert.equal(byMoveLine.get(901).existing_lot_id, 780)
  assert.equal(byMoveLine.get(901).existing_lot_name, 'O-MH08966-BED-NERISSA-001')
})

test('links a new lot to the subcontract MO before writing only lot_id to Detail', async () => {
  const writes = []
  const call = async (model, method, domain, options) => {
    if (model === 'stock.lot' && method === 'create') return 780
    if (method === 'write') {
      writes.push({ model, values: options.positionalArgs[0][1] })
      return true
    }
    throw new Error(`Unexpected Odoo call: ${model}.${method}`)
  }
  const result = await createAndAssignLot({
    name: 'O-MH08966-BED-NERISSA-001',
    product_id: 71,
    company_id: 1,
    move_line_id: 901,
    subcontract_mo_id: 3790,
    subcontract_mo_name: 'O-MID/SBC/00378',
  }, call)

  assert.deepEqual(writes, [
    { model: 'mrp.production', values: { lot_producing_ids: [[4, 780]] } },
    { model: 'stock.move.line', values: { lot_id: 780 } },
  ])
  assert.equal(result.id, 780)
  assert.equal(result.assign_method, 'subcontract_mo_then_lot_id')
})

test('blocks serial lines whose quantity is not exactly one', async () => {
  const { products, blockingIssues } = await collectSerialTargets(16910, 1, fakeOdoo({
    moveLines: [{
      id: 902,
      product_id: [71, 'ORD-BED-NERISSA (W1800)'],
      move_id: [501, 'move'],
      quantity: 2,
      qty_done: 0,
      lot_id: false,
      lot_name: false,
    }],
  }))

  assert.equal(products[0].need_lots, 0)
  assert.ok(blockingIssues.some((issue) => issue.code === 'serial_line_quantity_not_one'))
})

test('reports a serial already assigned on the receipt Detail', async () => {
  const { products, blockingIssues } = await collectSerialTargets(16910, 1, fakeOdoo({
    moveLines: [{
      id: 903,
      product_id: [71, 'ORD-BED-NERISSA (W1800)'],
      move_id: [501, 'move'],
      quantity: 1,
      qty_done: 0,
      lot_id: [803, 'MH09816-BED-NERISSA-001'],
      lot_name: false,
    }],
  }))

  assert.equal(blockingIssues.length, 0)
  assert.equal(products[0].need_lots, 0)
  assert.deepEqual(products[0].existing_lots, [{
    move_line_id: 903,
    id: 803,
    name: 'MH09816-BED-NERISSA-001',
    reason: 'Đã được gắn trên Detail của phiếu nhập.',
  }])
})

test('normalizes the product portion of the serial name', () => {
  assert.equal(slugifyProductName('ORD-MINI SOFA-YUKI (NATUS 508)'), 'MINI-SOFA-YUKI')
})

test('normalizes Vietnamese accents and casing for a lot segment', () => {
  assert.equal(slugifyProductName('ORD-Bàn ghế Đệm (màu đỏ)'), 'BAN-GHE-DEM')
  assert.equal(normalizeLotSegment('phiếu nhập/đợt 01'), 'PHIEU-NHAP-DOT-01')
})

test('uses the actual Purchase Order name as the first lot segment', async () => {
  const call = async (model) => {
    if (model === 'stock.picking') return [{ purchase_id: [12, 'PO-DISPLAY-NAME'] }]
    if (model === 'purchase.order') return [{ name: 'PO Việt/001' }]
    throw new Error(`Unexpected Odoo model: ${model}`)
  }

  assert.equal(await resolveSourceDocumentCode({ id: 42, name: 'MID/NHAN/00042' }, call), 'PO-VIET-001')
})

test('uses the actual Manufacturing Order name when there is no Purchase Order', async () => {
  const call = async (model) => {
    if (model === 'stock.picking') return [{ purchase_id: false }]
    if (model === 'stock.move') return [{ production_id: [15, 'MO-DISPLAY-NAME'] }]
    if (model === 'mrp.production') return [{ name: 'MO Sản xuất/001' }]
    throw new Error(`Unexpected Odoo model: ${model}`)
  }

  assert.equal(await resolveSourceDocumentCode({ id: 43, name: 'MID/NHAN/00043' }, call), 'MO-SAN-XUAT-001')
})
