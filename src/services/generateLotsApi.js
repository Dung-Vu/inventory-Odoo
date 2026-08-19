import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

/**
 * POST /api/generate-lots/preview
 *
 * Build a plan of which stock.lot names *would* be created for the given
 * receipt picking. Does NOT write anything to Odoo.
 *
 * @param {string} pickingName
 * @returns {Promise<{picking, po_code, products, total_to_create, total_skipped, applied, message}>}
 */
export async function previewLots(pickingName) {
  if (!pickingName) {
    throw new Error('Vui lòng nhập mã phiếu (pickingName)')
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/generate-lots/preview`,
      { pickingName: String(pickingName).trim() },
      { timeout: 60000 }
    )
    return response.data
  } catch (error) {
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error)
    }
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Server không phản hồi')
    }
    if (error.code === 'ERR_NETWORK') {
      throw new Error('Không thể kết nối đến server. Vui lòng kiểm tra backend server.')
    }
    throw new Error(error.message || 'Lỗi khi gọi preview API')
  }
}

/**
 * POST /api/generate-lots/apply
 *
 * Apply the lot-generation plan: create stock.lot records and link them
 * to the existing stock.move.line records.
 *
 * @param {string|number} pickingId Exact picking ID returned by preview.
 * @param {string} expectedPlanHash Rejects Apply if Details changed after preview.
 * @returns {Promise<{picking, po_code, products, total_to_create, total_skipped, total_created, total_failed, applied, message}>}
 */
export async function applyLots(pickingId, expectedPlanHash) {
  if (!pickingId) {
    throw new Error('Vui lòng nhập mã phiếu (pickingName)')
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/generate-lots/apply`,
      {
        pickingName: String(pickingId).trim(),
        expectedPlanHash,
      },
      { timeout: 120000 } // 2 minutes — apply can create many lots sequentially
    )
    return response.data
  } catch (error) {
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error)
    }
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Server không phản hồi')
    }
    if (error.code === 'ERR_NETWORK') {
      throw new Error('Không thể kết nối đến server. Vui lòng kiểm tra backend server.')
    }
    throw new Error(error.message || 'Lỗi khi gọi apply API')
  }
}
