import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignAbcClasses,
  isValidDateString,
  summarizeAbc,
  vnDateRangeToUtc,
} from '../server/abc-report.js'

test('vnDateRangeToUtc shifts Vietnam calendar days to UTC bounds', () => {
  assert.deepEqual(vnDateRangeToUtc('2026-09-01', '2026-09-30'), {
    start: '2026-08-31 17:00:00',
    end: '2026-09-30 16:59:59',
  })
  assert.deepEqual(vnDateRangeToUtc('2026-01-01', undefined), { start: '2025-12-31 17:00:00' })
  assert.deepEqual(vnDateRangeToUtc(undefined, undefined), {})
})

test('isValidDateString accepts only real YYYY-MM-DD dates', () => {
  assert.equal(isValidDateString('2026-02-28'), true)
  assert.equal(isValidDateString('2026-02-30'), false)
  assert.equal(isValidDateString('2026-9-1'), false)
  assert.equal(isValidDateString("2026-01-01' OR 1=1"), false)
  assert.equal(isValidDateString(undefined), false)
})

test('assignAbcClasses applies 80/95 cumulative thresholds', () => {
  const products = [
    { id: 'c', total_sales: 5 },
    { id: 'a', total_sales: 70 },
    { id: 'b', total_sales: 25 },
  ]
  assignAbcClasses(products)
  assert.deepEqual(products.map((p) => [p.id, p.rank, p.abc_class]), [
    ['a', 1, 'A'],
    ['b', 2, 'B'],
    ['c', 3, 'C'],
  ])
  assert.equal(products[2].cumulative_percent, 100)
})

test('empty period classifies everything as C, not A', () => {
  const products = [{ total_sales: 0 }, { total_sales: 0 }]
  assignAbcClasses(products)
  assert.deepEqual(products.map((p) => p.abc_class), ['C', 'C'])
  const summary = summarizeAbc(products)
  assert.equal(summary.classA_count, 0)
  assert.equal(summary.classC_count, 2)
  assert.equal(summary.classA_percent, 0)
})

test('zero-value products are C even when total is positive', () => {
  const products = [{ total_sales: 100 }, { total_sales: 0 }]
  assignAbcClasses(products)
  assert.deepEqual(products.map((p) => p.abc_class), ['A', 'C'])
})

test('summarizeAbc totals by class', () => {
  const products = assignAbcClasses([{ total_sales: 80 }, { total_sales: 15 }, { total_sales: 5 }])
  const s = summarizeAbc(products)
  assert.equal(s.totalRevenue, 100)
  assert.deepEqual([s.classA_count, s.classB_count, s.classC_count], [1, 1, 1])
  assert.equal(s.classB_percent, 15)
})

test('fabric Excel export writes one row per product plus a total row', async () => {
  const { default: ExcelJS } = await import('exceljs')
  const { buildFabricReportWorkbook } = await import('../src/utils/fabricReportExcel.js')
  const products = [
    { rank: 1, abc_class: 'A', name: 'F-ORD-LANA', default_code: 'N/A', company: 'Ordinaire', quantity_direct: 10, quantity_in_mo: 5, quantity_returned: 1, quantity_sold: 14, unit_price: 150000, price_source: 'cost', total_sales: 2100000, direct_revenue: 3600000, sales_percent: 70, cumulative_percent: 70 },
    { rank: 2, abc_class: 'B', name: 'F-BON-X', company: 'Bonario', quantity_in_mo: 3, quantity_sold: 3, unit_price: 300000, price_source: 'list', total_sales: 900000, sales_percent: 30, cumulative_percent: 100 },
  ]
  const workbook = await buildFabricReportWorkbook(ExcelJS, { products, summary: { totalRevenue: 3000000, totalDirectRevenue: 3600000 }, startDate: '2026-09-01', endDate: '2026-09-30' })
  const reread = new ExcelJS.Workbook()
  await reread.xlsx.load(await workbook.xlsx.writeBuffer())
  const sheet = reread.getWorksheet('Tiêu thụ vải')
  assert.match(sheet.getCell('A2').value, /2026-09-01 → 2026-09-30/)
  assert.equal(sheet.getCell('M5').value, 'Giá trị tiêu thụ (đ)')
  assert.deepEqual([sheet.getCell('C6').value, sheet.getCell('E6').value, sheet.getCell('J6').value, sheet.getCell('M6').value], ['F-ORD-LANA', '', 14, 2100000])
  assert.equal(sheet.getCell('L7').value, 'Giá niêm yết (thiếu giá vốn)')
  assert.deepEqual([sheet.getCell('C8').value, sheet.getCell('J8').value, sheet.getCell('M8').value, sheet.getCell('N8').value], ['Tổng', 17, 3000000, 3600000])
})
