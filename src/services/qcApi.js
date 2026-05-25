import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

/**
 * Check if a picking is already saved in QC
 */
export async function checkQcExists(pickingId) {
  const res = await axios.get(`${API_BASE_URL}/qc/check/${pickingId}`)
  return res.data
}

/**
 * Save a new QC batch with selected products
 */
export async function saveQcBatch({ picking, products, notes }) {
  const res = await axios.post(`${API_BASE_URL}/qc/save`, { picking, products, notes })
  return res.data
}

/**
 * Add products to an existing QC batch (skip duplicates)
 */
export async function addProductsToBatch({ pickingId, products }) {
  const res = await axios.post(`${API_BASE_URL}/qc/add-products`, { pickingId, products })
  return res.data
}

/**
 * List all QC batches
 */
export async function fetchQcList({ search = '', status = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams()
  if (search) params.append('search', search)
  if (status) params.append('status', status)
  params.append('limit', limit)
  params.append('offset', offset)

  const res = await axios.get(`${API_BASE_URL}/qc/list?${params.toString()}`)
  return res.data
}

/**
 * Get QC batch detail with items
 */
export async function fetchQcDetail(id) {
  const res = await axios.get(`${API_BASE_URL}/qc/${id}`)
  return res.data
}

/**
 * Update QC item status and notes
 */
export async function updateQcItem(itemId, { qc_status, notes }) {
  const res = await axios.put(`${API_BASE_URL}/qc/items/${itemId}`, { qc_status, notes })
  return res.data
}

/**
 * Update batch notes
 */
export async function updateQcNotes(batchId, notes) {
  const res = await axios.put(`${API_BASE_URL}/qc/${batchId}/notes`, { notes })
  return res.data
}

/**
 * Delete a QC batch
 */
export async function deleteQcBatch(batchId) {
  const res = await axios.delete(`${API_BASE_URL}/qc/${batchId}`)
  return res.data
}

/**
 * Get QC stats
 */
export async function fetchQcStats() {
  const res = await axios.get(`${API_BASE_URL}/qc/stats`)
  return res.data
}
