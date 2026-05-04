import axios from 'axios'

// Backend API URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

/**
 * Fetch picking data from backend
 * @param {string} pickingCode - Mã phiếu nhập kho
 * @returns {Promise<{picking: Object, products: Array}>}
 */
export async function fetchPickingData(pickingCode) {
  if (!pickingCode) {
    throw new Error('Vui lòng nhập mã phiếu')
  }

  try {
    const response = await axios.get(`${API_BASE_URL}/picking/${pickingCode}`, {
      timeout: 30000, // 30 seconds timeout
    })
    
    return response.data
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error('Không tìm thấy phiếu nhập kho')
    }
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error)
    }
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Server không phản hồi')
    }
    if (error.code === 'ERR_NETWORK') {
      throw new Error('Không thể kết nối đến server. Vui lòng kiểm tra backend server.')
    }
    throw new Error(error.message || 'Lỗi khi tải dữ liệu')
  }
}

/**
 * Fetch delivery info for recipient slip
 * @param {string} pickingCode - Mã phiếu giao hàng
 * @returns {Promise<{picking: Object, sender: Object, recipient: Object}>}
 */
export async function fetchDeliveryInfo(pickingCode) {
  if (!pickingCode) {
    throw new Error('Vui lòng nhập mã phiếu')
  }

  try {
    const response = await axios.get(`${API_BASE_URL}/delivery-info/${pickingCode}`, {
      timeout: 30000, // 30 seconds timeout
    })
    
    return response.data
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error('Không tìm thấy phiếu giao hàng')
    }
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error)
    }
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Server không phản hồi')
    }
    if (error.code === 'ERR_NETWORK') {
      throw new Error('Không thể kết nối đến server. Vui lòng kiểm tra backend server.')
    }
    throw new Error(error.message || 'Lỗi khi tải dữ liệu')
  }
}

/**
 * Fetch ABC analysis data for products filtered by variant tag
 * @param {Object} params - Filter parameters
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @param {string} params.productName - Product name filter
 * @param {string} params.variantTag - Variant tag filter
 * @returns {Promise<{products: Array, summary: Object, filters: Object}>}
 */
export async function fetchABCAnalysis({ startDate, endDate, productName, variantTag } = {}) {
  try {
    const params = new URLSearchParams()
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    if (productName) params.append('productName', productName)
    if (variantTag) params.append('variantTag', variantTag)

    const response = await axios.get(`${API_BASE_URL}/abc-analysis?${params.toString()}`, {
      timeout: 60000, // 60 seconds timeout for ABC analysis (may take longer)
    })
    
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
    throw new Error(error.message || 'Lỗi khi tải dữ liệu')
  }
}
