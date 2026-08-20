import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLotPlan,
  collectSerialTargets,
  createAndAssignLot,
  isGeneratedLotName,
  lotSequenceNamespace,
  nextSequences,
  normalizeLotSegment,
  prepareDoneMoReceiptRepair,
  reconcileDoneMoRepairs,
  resolveSubcontractAssignments,
  watchSubcontractAssignments,
  resolveSourceDocumentCode,
  slugifyProductName,
} from '../server/routes/generate-lots.js'

function fakeOdoo({ moveLines, moveQty = 1 }) {
  return async (model) => {
    if (model === 'stock.move') {
      return [{ id: 501, product_id: [71, 'ORD-BED-NERISSA (W1800)'], product_uom_qty: moveQty, is_subcontract: true }]
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
        state: 'confirmed',
        product_id: [71, 'ORD-BED-NERISSA (W1800)'],
        product_qty: 1,
        lot_producing_ids: [],
        move_finished_ids: [910],
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
    source_mo_state: 'confirmed',
    finished_move_id: 910,
  })
})

test('reuses an existing source-MO lot instead of creating another one', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [{
        id: 3790,
        name: 'O-MID/SBC/00378',
        state: 'confirmed',
        product_id: [71, 'ORD-BED-NERISSA (W1800)'],
        product_qty: 1,
        lot_producing_ids: [780],
        move_finished_ids: [910],
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
  assert.equal(byMoveLine.get(901).finished_move_id, 910)
})

test('records a watcher when lot Apply finishes before the subcontract MO is Done', () => {
  const saved = []
  const watched = watchSubcontractAssignments([{
    id: 780,
    product_id: 71,
    move_line_id: 901,
    receipt_move_id: 501,
    subcontract_mo_id: 3790,
    source_mo_state: 'confirmed',
    finished_move_id: 910,
  }], { id: 16910, name: 'O-MID/IN/00123' }, {
    save: (values) => {
      saved.push(values)
      return { id: 1, ...values }
    },
  })

  assert.equal(watched.length, 1)
  assert.deepEqual(saved, [{
    picking_id: 16910,
    picking_name: 'O-MID/IN/00123',
    receipt_move_id: 501,
    receipt_move_line_id: 901,
    finished_move_id: 910,
    production_id: 3790,
    product_id: 71,
    lot_id: 780,
    status: 'watching',
  }])
})

test('does not watch a subcontract MO that was already prepared as Done', () => {
  const watched = watchSubcontractAssignments([{
    id: 780,
    product_id: 71,
    move_line_id: 901,
    receipt_move_id: 501,
    subcontract_mo_id: 3790,
    source_mo_state: 'done',
    finished_move_id: 910,
  }], { id: 16910, name: 'O-MID/IN/00123' }, {
    save: () => { throw new Error('must not save') },
  })
  assert.deepEqual(watched, [])
})

test('watch reconciler safely detaches when the source MO later becomes Done', async () => {
  let linked = true
  const updates = []
  const repair = {
    id: 1,
    picking_id: 16910,
    picking_name: 'O-MID/IN/00123',
    receipt_move_id: 501,
    receipt_move_line_id: 901,
    finished_move_id: 910,
    production_id: 3790,
    product_id: 71,
    lot_id: 780,
    status: 'watching',
  }
  const receiptMove = () => ({
    id: 501,
    state: 'assigned',
    picked: false,
    is_subcontract: true,
    product_id: [71, 'product'],
    quantity: 1,
    purchase_line_id: [88, 'PO line'],
    move_orig_ids: linked ? [910] : [],
    move_line_ids: [901],
    location_id: [216, 'Subcontract'],
    location_dest_id: [244, 'Stock'],
  })
  const finishedMove = () => ({
    id: 910,
    state: 'done',
    picked: true,
    production_id: [3790, 'MO'],
    product_id: [71, 'product'],
    quantity: 1,
    move_dest_ids: linked ? [501] : [],
    location_id: [214, 'Production'],
    location_dest_id: [216, 'Subcontract'],
  })
  const production = {
    id: 3790,
    name: 'O-MID/SBC/00378',
    state: 'done',
    product_id: [71, 'product'],
    product_qty: 1,
    qty_produced: 1,
    lot_producing_ids: [780],
    move_finished_ids: [910],
  }
  const call = async (model, method, domain, options) => {
    const id = domain?.[0]
    if (method === 'read' && model === 'stock.picking') {
      return [{ id: 16910, name: 'O-MID/IN/00123', state: 'assigned', date_done: false }]
    }
    if (method === 'read' && model === 'stock.move' && id === 501) return [receiptMove()]
    if (method === 'read' && model === 'stock.move' && id === 910) return [finishedMove()]
    if (method === 'read' && model === 'stock.move.line') {
      return [{
        id: 901,
        state: 'assigned',
        picked: false,
        picking_id: [16910, 'receipt'],
        move_id: [501, 'move'],
        product_id: [71, 'product'],
        quantity: 1,
        lot_id: [780, 'STANDARD-001'],
        location_id: [216, 'Subcontract'],
        location_dest_id: [244, 'Stock'],
        company_id: [11, 'Ordinaire'],
      }]
    }
    if (method === 'read' && model === 'mrp.production') return [production]
    if (method === 'read' && model === 'stock.lot') {
      return [{ id: 780, name: 'STANDARD-001', product_id: [71, 'product'], company_id: [11, 'Ordinaire'] }]
    }
    if (method === 'search_read' && model === 'stock.quant') {
      return [{ id: 700, quantity: 1, reserved_quantity: 1, company_id: [11, 'Ordinaire'] }]
    }
    if (method === 'search_read' && model === 'stock.move.line') {
      return [{ id: 901, picking_id: [16910, 'receipt'], move_id: [501, 'move'], quantity: 1, picked: false }]
    }
    if (method === 'write' && model === 'stock.move') {
      const command = options.positionalArgs[0][1].move_orig_ids[0]
      linked = command[0] === 4
      return true
    }
    throw new Error(`Unexpected Odoo call: ${model}.${method}`)
  }
  const storage = {
    list: () => [repair],
    save: (values) => ({ id: 1, ...values }),
    update: (...args) => updates.push(args),
  }

  const result = await reconcileDoneMoRepairs(call, storage)
  assert.equal(linked, false)
  assert.deepEqual(result, { checked: 1, prepared: 1, relinked: 0 })
  assert.deepEqual(updates, [[1, 'prepared']])
})

test('plans a guarded receipt repair when the source subcontract MO was already produced', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [{
        id: 3966,
        name: 'O-MID/SBC/00426',
        state: 'done',
        product_id: [71, 'ORD-BED-NERISSA (W1800)'],
        product_qty: 1,
        qty_produced: 1,
        lot_producing_ids: [788],
        move_finished_ids: [63614],
        finished_move_line_ids: [59793],
      }]
    }
    if (model === 'stock.lot') return [{ id: 788, name: '0000202' }]
    throw new Error(`Unexpected Odoo model: ${model}`)
  }
  const { byMoveLine, blockingIssues, doneMoRepairs } = await resolveSubcontractAssignments(18029, [{
    product_id: 71,
    product_name: 'ORD-BED-NERISSA (W1800)',
    is_subcontract: true,
    plannable_lines: [{ id: 901, move_id: 63612, quantity: 1 }],
  }], call)

  assert.equal(blockingIssues.length, 0)
  assert.equal(byMoveLine.get(901).existing_lot_id, 788)
  assert.equal(byMoveLine.get(901).source_mo_state, 'done')
  assert.deepEqual(doneMoRepairs, [{
    product_id: 71,
    product_name: 'ORD-BED-NERISSA (W1800)',
    move_line_id: 901,
    receipt_move_id: 63612,
    subcontract_mo_id: 3966,
    subcontract_mo_name: 'O-MID/SBC/00426',
    finished_move_id: 63614,
    finished_move_line_id: 59793,
    lot_id: 788,
    lot_name: '0000202',
  }])
})

test('prepares a strictly matched done MO receipt and records it for automatic relink', async () => {
  let linked = true
  const statusUpdates = []
  const call = async (model, method, domain, options) => {
    const id = domain?.[0]
    if (method === 'read' && model === 'stock.move' && id === 63612) {
      return [{
        id: 63612,
        state: 'assigned',
        picked: false,
        is_subcontract: true,
        product_id: [71, 'product'],
        quantity: 1,
        purchase_line_id: [21149, 'PO line'],
        move_orig_ids: linked ? [63614] : [],
        move_line_ids: [901],
        location_id: [216, 'Subcontract'],
        location_dest_id: [244, 'Stock'],
      }]
    }
    if (method === 'read' && model === 'stock.move' && id === 63614) {
      return [{
        id: 63614,
        state: 'done',
        picked: true,
        production_id: [3966, 'MO'],
        product_id: [71, 'product'],
        quantity: 1,
        move_dest_ids: linked ? [63612] : [],
        location_id: [214, 'Production'],
        location_dest_id: [216, 'Subcontract'],
      }]
    }
    if (method === 'read' && model === 'stock.move.line') {
      return [{
        id: 901,
        state: 'assigned',
        picked: false,
        picking_id: [18029, 'receipt'],
        move_id: [63612, 'move'],
        product_id: [71, 'product'],
        quantity: 1,
        lot_id: [788, 'STANDARD-001'],
        location_id: [216, 'Subcontract'],
        location_dest_id: [244, 'Stock'],
        company_id: [11, 'Ordinaire'],
      }]
    }
    if (method === 'read' && model === 'mrp.production') {
      return [{
        id: 3966,
        name: 'O-MID/SBC/00426',
        state: 'done',
        product_id: [71, 'product'],
        product_qty: 1,
        qty_produced: 1,
        lot_producing_ids: [788],
        move_finished_ids: [63614],
      }]
    }
    if (method === 'read' && model === 'stock.lot') {
      return [{ id: 788, name: 'STANDARD-001', product_id: [71, 'product'], company_id: [11, 'Ordinaire'] }]
    }
    if (method === 'search_read' && model === 'stock.quant') {
      return [{ id: 43605, quantity: 1, reserved_quantity: 0, company_id: [11, 'Ordinaire'] }]
    }
    if (method === 'search_read' && model === 'stock.move.line') {
      return [{ id: 901, picking_id: [18029, 'receipt'], move_id: [63612, 'move'], quantity: 1, picked: false }]
    }
    if (method === 'write' && model === 'stock.move') {
      const command = options.positionalArgs[0][1].move_orig_ids[0]
      linked = command[0] === 4
      return true
    }
    throw new Error(`Unexpected Odoo call: ${model}.${method}`)
  }
  const storage = {
    save: (values) => ({ id: 5, ...values }),
    update: (...args) => statusUpdates.push(args),
  }
  const result = await prepareDoneMoReceiptRepair({
    product_id: 71,
    product_name: 'product',
    move_line_id: 901,
    receipt_move_id: 63612,
    subcontract_mo_id: 3966,
    subcontract_mo_name: 'O-MID/SBC/00426',
    finished_move_id: 63614,
    lot_id: 788,
    lot_name: 'STANDARD-001',
  }, { id: 18029, name: 'O-MID/IN/00351', state: 'assigned' }, call, storage)

  assert.equal(linked, false)
  assert.equal(result.prepared, true)
  assert.deepEqual(statusUpdates, [[5, 'prepared']])
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

test('recognizes only the expected PO/MO + slug + numeric lot format', () => {
  const product = { slug: 'SOFA-PUFFY-OTTOMAN-MODULE' }

  assert.equal(
    isGeneratedLotName('O-MH09105', product, 'O-MH09105-SOFA-PUFFY-OTTOMAN-MODULE-001'),
    true
  )
  assert.equal(isGeneratedLotName('O-MH09105', product, '0000202'), false)
  assert.equal(
    isGeneratedLotName('O-MH09105', product, 'O-MH09104-SOFA-PUFFY-OTTOMAN-MODULE-001'),
    false
  )
})

test('renames a non-standard source-MO lot before assigning the same lot ID to Detail', async () => {
  const writes = []
  const call = async (model, method, domain, options) => {
    if (model === 'stock.lot' && method === 'read') {
      return [{ id: 788, name: '0000202', product_id: [71, 'product'], company_id: [11, 'Ordinaire'] }]
    }
    if (model === 'stock.lot' && method === 'search_read') return []
    if (method === 'write') {
      writes.push({ model, values: options.positionalArgs[0][1] })
      return true
    }
    throw new Error(`Unexpected Odoo call: ${model}.${method}`)
  }

  const result = await createAndAssignLot({
    id: 788,
    name: 'O-MH09105-SOFA-PUFFY-OTTOMAN-MODULE-001',
    previous_name: '0000202',
    rename_source_lot: true,
    product_id: 71,
    company_id: 11,
    move_line_id: 901,
    subcontract_mo_id: 3966,
  }, call)

  assert.deepEqual(writes, [
    { model: 'stock.lot', values: { name: 'O-MH09105-SOFA-PUFFY-OTTOMAN-MODULE-001' } },
    { model: 'stock.move.line', values: { lot_id: 788 } },
  ])
  assert.equal(result.created, false)
  assert.equal(result.renamed, true)
  assert.equal(result.assign_method, 'source_lot_renamed_then_lot_id')
})

test('restores the source lot name when assigning the renamed lot to Detail fails', async () => {
  const lotNames = []
  const call = async (model, method, domain, options) => {
    if (model === 'stock.lot' && method === 'read') {
      return [{ id: 788, name: '0000202', product_id: [71, 'product'], company_id: [11, 'Ordinaire'] }]
    }
    if (model === 'stock.lot' && method === 'search_read') return []
    if (model === 'stock.lot' && method === 'write') {
      lotNames.push(options.positionalArgs[0][1].name)
      return true
    }
    if (model === 'stock.move.line' && method === 'write') throw new Error('Detail write failed')
    throw new Error(`Unexpected Odoo call: ${model}.${method}`)
  }

  await assert.rejects(
    createAndAssignLot({
      id: 788,
      name: 'O-MH09105-SOFA-PUFFY-OTTOMAN-MODULE-001',
      previous_name: '0000202',
      rename_source_lot: true,
      product_id: 71,
      company_id: 11,
      move_line_id: 901,
    }, call),
    /Detail write failed/
  )
  assert.deepEqual(lotNames, ['O-MH09105-SOFA-PUFFY-OTTOMAN-MODULE-001', '0000202'])
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

test('blocks a serial Detail line with quantity above one even when it already has a lot', async () => {
  const { blockingIssues } = await collectSerialTargets(16910, 1, fakeOdoo({
    moveQty: 2,
    moveLines: [{
      id: 904,
      product_id: [71, 'ORD-BED-NERISSA (W1800)'],
      move_id: [501, 'move'],
      quantity: 2,
      qty_done: 0,
      lot_id: [803, 'MH09816-BED-NERISSA-001'],
      lot_name: false,
    }],
  }))

  assert.ok(blockingIssues.some((issue) => issue.code === 'serial_line_quantity_not_one'))
})

test('blocks Apply when Detailed Operations total is lower than receipt demand', async () => {
  const { blockingIssues } = await collectSerialTargets(16910, 1, fakeOdoo({
    moveQty: 2,
    moveLines: [{
      id: 905,
      product_id: [71, 'ORD-BED-NERISSA (W1800)'],
      move_id: [501, 'move'],
      quantity: 1,
      qty_done: 0,
      lot_id: false,
      lot_name: false,
    }],
  }))

  assert.ok(blockingIssues.some((issue) => issue.code === 'serial_detail_quantity_mismatch'))
})

test('finds the next sequence across all variants in the same company and slug namespace', async () => {
  const product = {
    product_id: 72,
    slug: 'CHAIR-ARDEN',
    company_id: 11,
  }
  const calls = []
  const call = async (model, method, domain) => {
    calls.push({ model, method, domain })
    return [
      { name: 'O-MH09107-CHAIR-ARDEN-004' },
      { name: 'O-MH09107-CHAIR-ARDEN-009' },
    ]
  }

  const sequences = await nextSequences('O-MH09107', [product], call)

  assert.equal(sequences.get(lotSequenceNamespace('O-MH09107', product)), 10)
  assert.deepEqual(calls[0].domain, [
    ['company_id', '=', 11],
    ['name', '=ilike', 'O-MH09107-CHAIR-ARDEN-%'],
  ])
  assert.ok(!calls[0].domain.some(([field]) => field === 'product_id'))
})

test('shares one sequence namespace across product variants with the same lot slug', () => {
  const products = [
    {
      product_id: 71,
      product_name: 'ORD-CHAIR-ARDEN (MILE 100)',
      slug: 'CHAIR-ARDEN',
      company_id: 11,
      plannable_lines: [{ id: 901 }, { id: 902 }],
    },
    {
      product_id: 72,
      product_name: 'ORD-CHAIR-ARDEN (NEUS 903)',
      slug: 'CHAIR-ARDEN',
      company_id: 11,
      plannable_lines: [{ id: 903 }],
    },
  ]
  const namespace = lotSequenceNamespace('O-MH09107', products[0])
  const lots = buildLotPlan('O-MH09107', products, new Map([[namespace, 7]]))

  assert.deepEqual(lots.map((lot) => lot.name), [
    'O-MH09107-CHAIR-ARDEN-007',
    'O-MH09107-CHAIR-ARDEN-008',
    'O-MH09107-CHAIR-ARDEN-009',
  ])
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
