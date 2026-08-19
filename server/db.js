import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'qc.db');

// Ensure data directory exists
import { mkdirSync, existsSync } from 'fs';
if (!existsSync(path.dirname(DB_PATH))) {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS qc_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    picking_id INTEGER NOT NULL,
    picking_name TEXT NOT NULL,
    partner TEXT,
    origin TEXT,
    picking_type TEXT,
    scheduled_date TEXT,
    state TEXT,
    selected_count INTEGER DEFAULT 0,
    overall_status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS qc_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES qc_batches(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    variant TEXT,
    quantity REAL DEFAULT 0,
    uom TEXT DEFAULT 'Unit',
    lots TEXT,  -- JSON array of lot info
    qc_status TEXT DEFAULT 'pending',  -- pending, passed, failed, warning
    notes TEXT DEFAULT '',
    checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_qc_batches_picking ON qc_batches(picking_id);
  CREATE INDEX IF NOT EXISTS idx_qc_batches_status ON qc_batches(overall_status);
  CREATE INDEX IF NOT EXISTS idx_qc_batches_created ON qc_batches(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_qc_items_batch ON qc_items(batch_id);
  CREATE INDEX IF NOT EXISTS idx_qc_items_status ON qc_items(qc_status);

  CREATE TABLE IF NOT EXISTS lot_done_mo_repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    picking_id INTEGER NOT NULL,
    picking_name TEXT NOT NULL,
    receipt_move_id INTEGER NOT NULL,
    receipt_move_line_id INTEGER NOT NULL,
    finished_move_id INTEGER NOT NULL,
    production_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    lot_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'preparing',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(picking_id, receipt_move_id, finished_move_id)
  );

  CREATE INDEX IF NOT EXISTS idx_lot_done_mo_repairs_status
    ON lot_done_mo_repairs(status, picking_id);
`);

// ============ BATCH CRUD ============

export function createBatch(data) {
  const { picking_id, picking_name, partner, origin, picking_type, scheduled_date, state, selected_count, notes } = data;
  const stmt = db.prepare(`
    INSERT INTO qc_batches (picking_id, picking_name, partner, origin, picking_type, scheduled_date, state, selected_count, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(picking_id, picking_name, partner, origin, picking_type, scheduled_date, state, selected_count || 0, notes || '');
  return getById(result.lastInsertRowid);
}

export function getAllBatches({ search = '', status = '', limit = 50, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (search) {
    where.push('(picking_name LIKE ? OR partner LIKE ? OR origin LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push('overall_status = ?');
    params.push(status);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit, offset);

  const rows = db.prepare(`
    SELECT *,
      (SELECT COUNT(*) FROM qc_items WHERE batch_id = qc_batches.id) as total_items,
      (SELECT COUNT(*) FROM qc_items WHERE batch_id = qc_batches.id AND qc_status = 'passed') as passed_count,
      (SELECT COUNT(*) FROM qc_items WHERE batch_id = qc_batches.id AND qc_status = 'failed') as failed_count,
      (SELECT COUNT(*) FROM qc_items WHERE batch_id = qc_batches.id AND qc_status = 'warning') as warning_count,
      (SELECT COUNT(*) FROM qc_items WHERE batch_id = qc_batches.id AND qc_status = 'pending') as pending_count
    FROM qc_batches
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  const count = db.prepare(`SELECT COUNT(*) as total FROM qc_batches ${whereClause}`).get(...params.slice(0, -2));

  return { batches: rows, total: count.total };
}

export function getById(id) {
  const batch = db.prepare('SELECT * FROM qc_batches WHERE id = ?').get(id);
  if (!batch) return null;

  const items = db.prepare('SELECT * FROM qc_items WHERE batch_id = ? ORDER BY id').all(id);
  return { ...batch, items };
}

export function updateBatchStatus(id, status) {
  return db.prepare(`
    UPDATE qc_batches SET overall_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, id);
}

export function updateBatchNotes(id, notes) {
  return db.prepare(`
    UPDATE qc_batches SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(notes, id);
}

export function deleteBatch(id) {
  return db.prepare('DELETE FROM qc_batches WHERE id = ?').run(id);
}

// ============ ITEM CRUD ============

export function createItems(items) {
  const stmt = db.prepare(`
    INSERT INTO qc_items (batch_id, product_id, product_name, variant, quantity, uom, lots)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(
        item.batch_id,
        item.product_id,
        item.product_name,
        item.variant || null,
        item.quantity || 0,
        item.uom || 'Unit',
        item.lots ? JSON.stringify(item.lots) : null
      );
    }
  });

  insertMany(items);
}

export function updateItem(id, { qc_status, notes }) {
  const now = qc_status && qc_status !== 'pending' ? new Date().toISOString() : null;
  return db.prepare(`
    UPDATE qc_items
    SET qc_status = COALESCE(?, qc_status),
        notes = COALESCE(?, notes),
        checked_at = COALESCE(?, checked_at)
    WHERE id = ?
  `).run(qc_status, notes, now, id);
}

export function deleteItem(id) {
  return db.prepare('DELETE FROM qc_items WHERE id = ?').run(id);
}

// ============ AUTO-UPDATE BATCH STATUS ============

export function recalcBatchStatus(batchId) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN qc_status = 'passed' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN qc_status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN qc_status = 'warning' THEN 1 ELSE 0 END) as warning,
      SUM(CASE WHEN qc_status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM qc_items WHERE batch_id = ?
  `).get(batchId);

  let overall = 'pending';
  if (counts.total > 0) {
    if (counts.failed > 0) overall = 'failed';
    else if (counts.warning > 0) overall = 'warning';
    else if (counts.passed === counts.total) overall = 'passed';
    else if (counts.passed > 0) overall = 'partial';
  }

  db.prepare(`
    UPDATE qc_batches SET overall_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(overall, batchId);

  return overall;
}

// ============ DONE SUBCONTRACT MO RECEIPT REPAIRS ============

export function saveDoneMoRepair(data) {
  db.prepare(`
    INSERT INTO lot_done_mo_repairs (
      picking_id, picking_name, receipt_move_id, receipt_move_line_id,
      finished_move_id, production_id, product_id, lot_id, status, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(picking_id, receipt_move_id, finished_move_id) DO UPDATE SET
      receipt_move_line_id = excluded.receipt_move_line_id,
      production_id = excluded.production_id,
      product_id = excluded.product_id,
      lot_id = excluded.lot_id,
      status = excluded.status,
      error = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    data.picking_id,
    data.picking_name,
    data.receipt_move_id,
    data.receipt_move_line_id,
    data.finished_move_id,
    data.production_id,
    data.product_id,
    data.lot_id,
    data.status || 'preparing'
  );
  return db.prepare(`
    SELECT * FROM lot_done_mo_repairs
    WHERE picking_id = ? AND receipt_move_id = ? AND finished_move_id = ?
  `).get(data.picking_id, data.receipt_move_id, data.finished_move_id);
}

export function updateDoneMoRepairStatus(id, status, error = null) {
  return db.prepare(`
    UPDATE lot_done_mo_repairs
    SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, error, id);
}

export function listPendingDoneMoRepairs() {
  return db.prepare(`
    SELECT * FROM lot_done_mo_repairs
    WHERE status IN ('preparing', 'prepared')
    ORDER BY id
  `).all();
}

// ============ STATS ============

export function getStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total_batches,
      COALESCE(SUM(CASE WHEN overall_status = 'passed' THEN 1 ELSE 0 END), 0) as passed_batches,
      COALESCE(SUM(CASE WHEN overall_status = 'pending' THEN 1 ELSE 0 END), 0) as pending_batches,
      COALESCE(SUM(CASE WHEN overall_status = 'failed' THEN 1 ELSE 0 END), 0) as failed_batches,
      COALESCE(SUM(CASE WHEN overall_status = 'warning' THEN 1 ELSE 0 END), 0) as warning_batches,
      (SELECT COUNT(*) FROM qc_items) as total_items,
      (SELECT COUNT(*) FROM qc_items WHERE qc_status = 'passed') as passed_items,
      (SELECT COUNT(*) FROM qc_items WHERE qc_status = 'pending') as pending_items,
      (SELECT COUNT(*) FROM qc_items WHERE qc_status = 'failed') as failed_items
    FROM qc_batches
  `).get();
  return row;
}

export { db };
export default db;
