import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLotPlan,
  collectSerialTargets,
  createAndAssignLot,
  isGeneratedLotName,
  lotSequenceNamespace,
  makePlan,
  nextSequences,
  normalizeLotSegment,
  prepareDoneMoReceiptRepair,
  previewResponse,
  reconcileDoneMoRepairs,
  resolveCurrentSplitTargetMO,
  resolveSubcontractAssignments,
  runGenerateLots,
  verifySplitSubcontractMOs,
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

function createSubcontractSplitScenario({ failOnMoveLineWriteId = null } = {}) {
  const picking = {
    id: 19146,
    name: 'O-MID/IN/00464',
    state: 'assigned',
    origin: 'O-MH09123',
    company_id: [11, 'Ordinaire'],
    picking_type_id: [1, 'Receipts'],
    scheduled_date: '2026-10-15 08:00:00',
    purchase_id: [501, 'O-MH09123'],
    date_done: false,
  }
  const moves = [
    {
      id: 66806,
      picking_id: [19146, 'O-MID/IN/00464'],
      product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
      product_uom_qty: 2,
      quantity: 2,
      is_subcontract: true,
      state: 'assigned',
      picked: false,
      move_orig_ids: [66809],
      move_line_ids: [63292, 63293],
    },
    {
      id: 66807,
      picking_id: [19146, 'O-MID/IN/00464'],
      product_id: [102, 'ORD-SOFA-RELAX (FABRIC)'],
      product_uom_qty: 1,
      quantity: 1,
      is_subcontract: true,
      state: 'assigned',
      picked: false,
      move_orig_ids: [66808],
      move_line_ids: [63294],
    },
  ]
  const finishedMoves = new Map([
    [
      66809,
      {
        id: 66809,
        state: 'confirmed',
        picked: false,
        production_id: [4149, 'O-MID/SBC/00551'],
        product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
        quantity: 2,
        move_dest_ids: [66806],
      },
    ],
  ])
  const moveLines = [
    {
      id: 63292,
      picking_id: [19146, 'O-MID/IN/00464'],
      product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
      move_id: [66806, 'move'],
      state: 'assigned',
      quantity: 1,
      qty_done: 0,
      lot_id: false,
      lot_name: false,
    },
    {
      id: 63293,
      picking_id: [19146, 'O-MID/IN/00464'],
      product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
      move_id: [66806, 'move'],
      state: 'assigned',
      quantity: 1,
      qty_done: 0,
      lot_id: false,
      lot_name: false,
    },
    {
      id: 63294,
      picking_id: [19146, 'O-MID/IN/00464'],
      product_id: [102, 'ORD-SOFA-RELAX (FABRIC)'],
      move_id: [66807, 'move'],
      state: 'assigned',
      quantity: 1,
      qty_done: 0,
      lot_id: false,
      lot_name: false,
    },
  ]
  const products = [
    {
      id: 101,
      name: 'ORD-ARMCHAIR-MILD (LIBERTY 2)',
      tracking: 'serial',
      company_id: [11, 'Ordinaire'],
    },
    {
      id: 102,
      name: 'ORD-SOFA-RELAX (FABRIC)',
      tracking: 'none',
      company_id: [11, 'Ordinaire'],
    },
  ]
  const mos = [
    {
      id: 4149,
      name: 'O-MID/SBC/00551',
      incoming_picking: [19146, 'O-MID/IN/00464'],
      state: 'confirmed',
      product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
      product_qty: 2,
      qty_produced: 0,
      lot_producing_ids: [],
      move_finished_ids: [66809],
      finished_move_line_ids: [],
    },
    {
      id: 4148,
      name: 'O-MID/SBC/00550',
      incoming_picking: [19146, 'O-MID/IN/00464'],
      state: 'done',
      product_id: [102, 'ORD-SOFA-RELAX (FABRIC)'],
      product_qty: 1,
      qty_produced: 1,
      lot_producing_ids: [],
      move_finished_ids: [66808],
      finished_move_line_ids: [59999],
    },
  ]
  const lots = []
  const unlinks = []
  let nextLotId = 9001
  let nextMoId = 4150
  let nextFinishedMoveId = 66810
  let failLineId = failOnMoveLineWriteId

  const call = async (model, method, domain, options) => {
    if (model === 'stock.picking' && (method === 'search_read' || method === 'read')) {
      return [picking]
    }
    if (model === 'stock.picking.type' && method === 'read') {
      return [{ id: 1, code: 'incoming', use_create_lots: true, use_existing_lots: true }]
    }
    if (model === 'purchase.order' && method === 'read') {
      return [{ id: 501, name: 'O-MH09123' }]
    }
    if (model === 'stock.move' && method === 'search_read') {
      return moves
    }
    if (model === 'stock.move' && method === 'read') {
      const requestedIds = Array.isArray(domain?.[0]) ? domain[0] : domain
      return requestedIds
        .map((id) => moves.find((m) => m.id === id) || finishedMoves.get(id))
        .filter(Boolean)
    }
    if (model === 'stock.move.line' && (method === 'search_read' || method === 'read')) {
      if (method === 'read') {
        const requestedIds = Array.isArray(domain?.[0]) ? domain[0] : domain
        return moveLines.filter((l) => requestedIds.includes(l.id))
      }
      const idDomain = (domain || []).find((clause) => Array.isArray(clause) && clause[0] === 'id')
      if (idDomain && Array.isArray(idDomain[2])) {
        return moveLines.filter((l) => idDomain[2].includes(l.id))
      }
      return moveLines
    }
    if (model === 'product.product' && method === 'search_read') {
      return products
    }
    if (model === 'mrp.production' && method === 'search_read') {
      const productDomain = (domain || []).find(
        (clause) => Array.isArray(clause) && clause[0] === 'product_id'
      )
      const allowedProductIds = productDomain?.[2] || null
      return mos.filter(
        (mo) => !allowedProductIds || allowedProductIds.includes(mo.product_id[0])
      )
    }
    if (model === 'mrp.production' && method === 'read') {
      const requestedIds = Array.isArray(domain?.[0]) ? domain[0] : domain
      return mos.filter((mo) => requestedIds.includes(mo.id))
    }
    if (model === 'stock.lot' && method === 'search_read') {
      const idDomain = (domain || []).find((clause) => Array.isArray(clause) && clause[0] === 'id')
      if (idDomain && Array.isArray(idDomain[2])) {
        return lots.filter((l) => idDomain[2].includes(l.id))
      }
      return lots
    }
    if (model === 'stock.lot' && method === 'create') {
      const payload = options.positionalArgs[0][0]
      const id = nextLotId++
      lots.push({
        id,
        name: payload.name,
        product_id: [payload.product_id, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
        company_id: payload.company_id ? [payload.company_id, 'Ordinaire'] : false,
      })
      return id
    }
    if (model === 'stock.lot' && method === 'unlink') {
      const ids = options.positionalArgs[0][0]
      unlinks.push({ model: 'stock.lot', ids })
      for (const id of ids) {
        const index = lots.findIndex((l) => l.id === id)
        if (index >= 0) lots.splice(index, 1)
      }
      return true
    }
    if (model === 'mrp.production' && method === 'write') {
      const [[moIds, values]] = options.positionalArgs
      for (const moId of moIds) {
        const mo = mos.find((item) => item.id === moId)
        if (!mo) throw new Error(`Unknown MO ${moId}`)
        for (const cmd of values.lot_producing_ids || []) {
          if (cmd[0] === 4 && !mo.lot_producing_ids.includes(cmd[1])) {
            mo.lot_producing_ids = [...mo.lot_producing_ids, cmd[1]]
          } else if (cmd[0] === 3) {
            mo.lot_producing_ids = mo.lot_producing_ids.filter((id) => id !== cmd[1])
          }
        }
      }
      return true
    }
    if (model === 'stock.move.line' && method === 'write') {
      const [[lineIds, values]] = options.positionalArgs
      for (const lineId of lineIds) {
        if (failLineId === lineId) {
          throw new Error(`Simulated write failure on move line ${lineId}`)
        }
        const line = moveLines.find((item) => item.id === lineId)
        const lot = lots.find((item) => item.id === values.lot_id)
        line.lot_id = [lot.id, lot.name]

        // Simulate Odoo mrp_subcontracting._sync_subcontracting_productions()
        const receiptMove = moves.find((m) => m.id === line.move_id[0])
        const siblingLines = moveLines.filter((l) => l.move_id[0] === receiptMove.id)
        const lotlessQty = siblingLines
          .filter((l) => !l.lot_id)
          .reduce((sum, l) => sum + l.quantity, 0)
        const matchedMO = mos.find((mo) => mo.lot_producing_ids?.[0] === lot.id)
        if (matchedMO && matchedMO.product_qty > 1) {
          matchedMO.product_qty = 1
          const existingFinished = finishedMoves.get(matchedMO.move_finished_ids[0])
          if (existingFinished) existingFinished.quantity = 1
          if (lotlessQty > 0) {
            const newMoId = nextMoId++
            const newFinishedId = nextFinishedMoveId++
            mos.push({
              id: newMoId,
              name: `${matchedMO.name}-${String(newMoId - 4148).padStart(3, '0')}`,
              incoming_picking: [19146, 'O-MID/IN/00464'],
              state: 'confirmed',
              product_id: matchedMO.product_id,
              product_qty: lotlessQty,
              qty_produced: 0,
              lot_producing_ids: [],
              move_finished_ids: [newFinishedId],
              finished_move_line_ids: [],
            })
            finishedMoves.set(newFinishedId, {
              id: newFinishedId,
              state: 'confirmed',
              picked: false,
              production_id: [newMoId, 'MO'],
              product_id: matchedMO.product_id,
              quantity: lotlessQty,
              move_dest_ids: [receiptMove.id],
            })
            receiptMove.move_orig_ids = [...receiptMove.move_orig_ids, newFinishedId]
          }
        }
      }
      return true
    }
    throw new Error(`Unexpected Odoo call: ${model}.${method}`)
  }

  return {
    call,
    mos,
    lots,
    moves,
    moveLines,
    unlinks,
    setFailLineId: (id) => {
      failLineId = id
    },
  }
}

test('(a) preview of picking 19146: armchair qty-2 open MO plans 2 lots with split flag and ignores non-serial sofa', async () => {
  const scenario = createSubcontractSplitScenario()
  const plan = await makePlan('O-MID/IN/00464', scenario.call)
  const preview = previewResponse(plan)

  assert.equal(preview.can_apply, true)
  assert.equal(preview.blocking_issues.length, 0)
  assert.equal(preview.products.length, 1)
  assert.equal(preview.products[0].product_id, 101)
  assert.equal(preview.products[0].split_from_mo, true)
  assert.match(
    preview.products[0].split_note,
    /MO O-MID\/SBC\/00551 SL 2 sẽ được Odoo tách thành 2 MO SL 1 khi gán serial/
  )
  assert.equal(preview.total_to_assign, 2)
  assert.equal(preview.total_to_create, 2)
  assert.equal(preview.total_done_mos_to_prepare, 0)
  assert.deepEqual(
    preview.products[0].lots.map((lot) => ({
      name: lot.name,
      move_line_id: lot.move_line_id,
      split_from_mo: lot.split_from_mo,
      subcontract_mo_name: lot.subcontract_mo_name,
    })),
    [
      {
        name: 'O-MH09123-ARMCHAIR-MILD-001',
        move_line_id: 63292,
        split_from_mo: true,
        subcontract_mo_name: 'O-MID/SBC/00551',
      },
      {
        name: 'O-MH09123-ARMCHAIR-MILD-002',
        move_line_id: 63293,
        split_from_mo: true,
        subcontract_mo_name: 'O-MID/SBC/00551',
      },
    ]
  )

  const planAgain = await makePlan('O-MID/IN/00464', scenario.call)
  assert.equal(planAgain.hash, plan.hash)
  assert.equal(scenario.lots.length, 0)
})

test('(b) apply simulates Odoo split into 2 MOs each with 1 lot and no unlink', async () => {
  const scenario = createSubcontractSplitScenario()
  const savedWatches = []
  const storage = {
    save: (values) => {
      const record = { id: savedWatches.length + 1, ...values }
      savedWatches.push(record)
      return record
    },
    update: () => {},
    list: () => savedWatches,
  }

  const plan = await makePlan('O-MID/IN/00464', scenario.call)
  const result = await runGenerateLots('O-MID/IN/00464', plan.hash, scenario.call, storage)

  assert.equal(result.applied, true)
  assert.equal(result.total_failed, 0)
  assert.equal(result.total_created, 2)
  assert.equal(result.total_assigned, 2)
  assert.equal(result.total_prepared_done_mos, 0)
  assert.equal(result.total_watched_subcontract_mos, 2)
  assert.equal(scenario.unlinks.length, 0)

  const armchairMOs = scenario.mos.filter((mo) => mo.product_id[0] === 101)
  assert.equal(armchairMOs.length, 2)
  assert.deepEqual(
    armchairMOs.map((mo) => ({
      id: mo.id,
      product_qty: mo.product_qty,
      lot_producing_ids: mo.lot_producing_ids,
    })),
    [
      { id: 4149, product_qty: 1, lot_producing_ids: [9001] },
      { id: 4150, product_qty: 1, lot_producing_ids: [9002] },
    ]
  )

  assert.equal(savedWatches.length, 2)
  assert.deepEqual(
    savedWatches.map((w) => ({
      production_id: w.production_id,
      finished_move_id: w.finished_move_id,
      lot_id: w.lot_id,
      status: w.status,
    })),
    [
      { production_id: 4149, finished_move_id: 66809, lot_id: 9001, status: 'watching' },
      { production_id: 4150, finished_move_id: 66810, lot_id: 9002, status: 'watching' },
    ]
  )

  const reconcileResult = await reconcileDoneMoRepairs(scenario.call, storage)
  assert.deepEqual(reconcileResult, { checked: 2, prepared: 0, relinked: 0 })
})

test('(c) Done subcontract MO with product_qty 2 remains blocked', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [{
        id: 4149,
        name: 'O-MID/SBC/00551',
        state: 'done',
        product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
        product_qty: 2,
        qty_produced: 2,
        lot_producing_ids: [],
        move_finished_ids: [66809],
        finished_move_line_ids: [70001, 70002],
      }]
    }
    throw new Error(`Unexpected Odoo model: ${model}`)
  }

  const { byMoveLine, blockingIssues, doneMoRepairs } = await resolveSubcontractAssignments(
    19146,
    [{
      product_id: 101,
      product_name: 'ORD-ARMCHAIR-MILD (LIBERTY 2)',
      is_subcontract: true,
      plannable_lines: [
        { id: 63292, move_id: 66806, quantity: 1 },
        { id: 63293, move_id: 66806, quantity: 1 },
      ],
    }],
    call
  )

  assert.equal(byMoveLine.size, 0)
  assert.equal(doneMoRepairs.length, 0)
  assert.equal(blockingIssues.length, 1)
  assert.equal(blockingIssues[0].code, 'subcontract_source_mo_mismatch')
})

test('(d) two lot-less open subcontract MOs with qty > 1 for the same product are blocked', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [
        {
          id: 4149,
          name: 'O-MID/SBC/00551',
          state: 'confirmed',
          product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
          product_qty: 2,
          qty_produced: 0,
          lot_producing_ids: [],
          move_finished_ids: [66809],
        },
        {
          id: 4150,
          name: 'O-MID/SBC/00552',
          state: 'confirmed',
          product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
          product_qty: 2,
          qty_produced: 0,
          lot_producing_ids: [],
          move_finished_ids: [66810],
        },
      ]
    }
    throw new Error(`Unexpected Odoo model: ${model}`)
  }

  const { byMoveLine, blockingIssues } = await resolveSubcontractAssignments(
    19146,
    [{
      product_id: 101,
      product_name: 'ORD-ARMCHAIR-MILD (LIBERTY 2)',
      is_subcontract: true,
      plannable_lines: [
        { id: 63292, move_id: 66806, quantity: 1 },
        { id: 63293, move_id: 66806, quantity: 1 },
        { id: 63294, move_id: 66806, quantity: 1 },
        { id: 63295, move_id: 66806, quantity: 1 },
      ],
    }],
    call
  )

  assert.equal(byMoveLine.size, 0)
  assert.equal(blockingIssues.length, 1)
  assert.equal(blockingIssues[0].code, 'subcontract_source_mo_mismatch')
})

test('(e) partial failure on 2nd line leaves state plannable via qty-1 path on next preview', async () => {
  const scenario = createSubcontractSplitScenario({ failOnMoveLineWriteId: 63293 })
  const savedWatches = []
  const storage = {
    save: (values) => {
      const record = { id: savedWatches.length + 1, ...values }
      savedWatches.push(record)
      return record
    },
    update: () => {},
    list: () => savedWatches,
  }

  const firstPlan = await makePlan('O-MID/IN/00464', scenario.call)
  const firstApply = await runGenerateLots(
    'O-MID/IN/00464',
    firstPlan.hash,
    scenario.call,
    storage
  )

  assert.equal(firstApply.total_assigned, 1)
  assert.equal(firstApply.total_failed, 1)
  assert.equal(firstApply.products[0].lots.length, 1)
  assert.equal(firstApply.products[0].lots[0].move_line_id, 63292)
  assert.equal(firstApply.products[0].failed.length, 1)
  assert.equal(firstApply.products[0].failed[0].move_line_id, 63293)

  // Now clear the simulated error and run the next Preview
  scenario.setFailLineId(null)
  const secondPlan = await makePlan('O-MID/IN/00464', scenario.call)
  const secondPreview = previewResponse(secondPlan)

  assert.equal(secondPreview.can_apply, true)
  assert.equal(secondPreview.blocking_issues.length, 0)
  assert.equal(secondPreview.total_to_assign, 1)
  assert.equal(secondPreview.total_skipped, 1)
  assert.equal(secondPreview.products[0].split_from_mo, false)
  assert.equal(secondPreview.products[0].lots.length, 1)
  assert.equal(secondPreview.products[0].lots[0].move_line_id, 63293)
  assert.equal(secondPreview.products[0].lots[0].split_from_mo, false)
  assert.equal(secondPreview.products[0].lots[0].name, 'O-MH09123-ARMCHAIR-MILD-002')

  const secondApply = await runGenerateLots(
    'O-MID/IN/00464',
    secondPlan.hash,
    scenario.call,
    storage
  )
  assert.equal(secondApply.total_failed, 0)
  assert.equal(secondApply.total_assigned, 1)
})

test('throws 409 Preview lại when first split item target MO no longer matches expected state or qty', async () => {
  const scenario = createSubcontractSplitScenario()
  const plan = await makePlan('O-MID/IN/00464', scenario.call)

  // Mutate target MO qty after Preview
  scenario.mos[0].product_qty = 3

  await assert.rejects(
    async () => {
      await createAndAssignLot(plan.lots[0], scenario.call)
    },
    (error) => {
      assert.equal(error.status, 409)
      assert.match(error.message, /Preview lại/)
      return true
    }
  )
})

test('reports post-apply verification mismatch in splitFailed when MO qty is not shrunk to 1', async () => {
  const call = async (model) => {
    if (model === 'mrp.production') {
      return [{
        id: 4149,
        name: 'O-MID/SBC/00551',
        state: 'confirmed',
        product_id: [101, 'ORD-ARMCHAIR-MILD (LIBERTY 2)'],
        product_qty: 2,
        qty_produced: 0,
        lot_producing_ids: [9001],
        move_finished_ids: [66809],
      }]
    }
    throw new Error(`Unexpected Odoo model: ${model}`)
  }

  const { verified, splitFailed } = await verifySplitSubcontractMOs(
    [{
      id: 9001,
      name: 'O-MH09123-ARMCHAIR-MILD-001',
      product_id: 101,
      move_line_id: 63292,
      split_from_mo: true,
    }],
    19146,
    call
  )

  assert.equal(verified.length, 0)
  assert.equal(splitFailed.length, 1)
  assert.equal(splitFailed[0].move_line_id, 63292)
})
