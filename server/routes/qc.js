import express from 'express';
import * as db from '../db.js';
import { db as dbInstance } from '../db.js';

const router = express.Router();

// ============ SAVE NEW QC BATCH ============
router.post('/qc/save', (req, res) => {
  try {
    const { picking, products, notes } = req.body;

    if (!picking || !products || products.length === 0) {
      return res.status(400).json({ error: 'Thiếu thông tin phiếu hoặc sản phẩm' });
    }

    const batch = db.createBatch({
      picking_id: picking.id,
      picking_name: picking.name,
      partner: picking.partner || 'N/A',
      origin: picking.origin || '',
      picking_type: picking.picking_type || '',
      scheduled_date: picking.scheduled_date || '',
      state: picking.state || '',
      selected_count: products.length,
      notes: notes || '',
    });

    const items = products.map(p => ({
      batch_id: batch.id,
      product_id: p.product_id,
      product_name: p.product_name,
      variant: p.variant || null,
      quantity: p.quantity || 0,
      uom: p.uom || 'Unit',
      lots: p.lots || [],
    }));
    db.createItems(items);

    const result = db.getById(batch.id);
    console.log(`[QC] Saved batch #${batch.id}: ${picking.name} (${products.length} items)`);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[QC Save Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CHECK IF PICKING ALREADY SAVED ============
router.get('/qc/check/:pickingId', (req, res) => {
  try {
    const { pickingId } = req.params;
    const batch = dbInstance.prepare('SELECT * FROM qc_batches WHERE picking_id = ? ORDER BY created_at DESC LIMIT 1').get(parseInt(pickingId));
    
    if (batch) {
      const items = dbInstance.prepare('SELECT * FROM qc_items WHERE batch_id = ?').all(batch.id);
      res.json({ exists: true, batch: { ...batch, items } });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('[QC Check Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ADD PRODUCTS TO EXISTING BATCH ============
router.post('/qc/add-products', (req, res) => {
  try {
    const { pickingId, products } = req.body;

    if (!pickingId || !products || products.length === 0) {
      return res.status(400).json({ error: 'Thiếu thông tin' });
    }

    // Find existing batch
    const batch = dbInstance.prepare('SELECT * FROM qc_batches WHERE picking_id = ? ORDER BY created_at DESC LIMIT 1').get(parseInt(pickingId));
    if (!batch) {
      return res.status(404).json({ error: 'Không tìm thấy batch' });
    }

    // Allow re-adding same product with remaining quantity (partial QC scenario)
    const newProducts = products;

    if (newProducts.length === 0) {
      return res.json({ success: true, added: 0, message: 'Không có sản phẩm nào để thêm' });
    }

    // Add new items
    const items = newProducts.map(p => ({
      batch_id: batch.id,
      product_id: p.product_id,
      product_name: p.product_name,
      variant: p.variant || null,
      quantity: p.quantity || 0,
      uom: p.uom || 'Unit',
      lots: p.lots || [],
    }));
    db.createItems(items);

    // Update batch selected_count
    dbInstance.prepare('UPDATE qc_batches SET selected_count = selected_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newProducts.length, batch.id);

    // Recalculate batch status
    db.recalcBatchStatus(batch.id);

    console.log(`[QC] Added ${newProducts.length} products to batch #${batch.id}`);
    res.json({ success: true, added: newProducts.length, total: batch.selected_count + newProducts.length });
  } catch (error) {
    console.error('[QC Add Products Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ LIST ALL BATCHES ============
router.get('/qc/list', (req, res) => {
  try {
    const { search, status, limit = 50, offset = 0 } = req.query;
    const result = db.getAllBatches({
      search: search || '',
      status: status || '',
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json(result);
  } catch (error) {
    console.error('[QC List Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ STATS (MUST be before /qc/:id) ============
router.get('/qc/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('[QC Stats Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET BATCH DETAIL (MUST be after specific routes) ============
router.get('/qc/:id', (req, res) => {
  try {
    const batch = db.getById(parseInt(req.params.id));
    if (!batch) {
      return res.status(404).json({ error: 'Không tìm thấy QC record' });
    }
    res.json(batch);
  } catch (error) {
    console.error('[QC Detail Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ UPDATE ITEM STATUS ============
router.put('/qc/items/:itemId', (req, res) => {
  try {
    const { itemId } = req.params;
    const { qc_status, notes } = req.body;

    db.updateItem(parseInt(itemId), { qc_status, notes });

    const item = dbInstance.prepare('SELECT batch_id FROM qc_items WHERE id = ?').get(parseInt(itemId));
    if (item) {
      const overall = db.recalcBatchStatus(item.batch_id);
      res.json({ success: true, overall_status: overall });
    } else {
      res.json({ success: true });
    }
  } catch (error) {
    console.error('[QC Update Item Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ UPDATE BATCH NOTES ============
router.put('/qc/:id/notes', (req, res) => {
  try {
    const { notes } = req.body;
    db.updateBatchNotes(parseInt(req.params.id), notes);
    res.json({ success: true });
  } catch (error) {
    console.error('[QC Update Notes Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ DELETE BATCH ============
router.delete('/qc/:id', (req, res) => {
  try {
    db.deleteBatch(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('[QC Delete Error]:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
