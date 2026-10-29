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
