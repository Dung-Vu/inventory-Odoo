import { useMemo, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Printer, Layers, Boxes, Search } from 'lucide-react'
import { jsPDF } from 'jspdf'
import ProductCard from './ProductCard'
import toast from 'react-hot-toast'
import Button from './ui/Button'
import Badge from './ui/Badge'
import robotoRegularUrl from '../fonts/Roboto-Regular.ttf?url'

export default function ProductsList({ products, picking }) {
  const [multipliers, setMultipliers] = useState({})
  const [productQuery, setProductQuery] = useState('')

  useEffect(() => {
    const initialMultipliers = {}
    products.forEach((p) => {
      initialMultipliers[p.product_id] = ''
    })
    setMultipliers(initialMultipliers)
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return products

    return products.filter((p) => {
      const haystackParts = [
        p.product_name,
        p.product_id,
        p.variant,
        ...(Array.isArray(p.lots) ? p.lots.map((l) => l?.lot_name) : []),
      ]
      const haystack = haystackParts.filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [products, productQuery])

  const handleMultiplierChange = (productId, value) => {
    setMultipliers((prev) => ({ ...prev, [productId]: value }))
  }

  const handlePrintAll = () => {
    printAllLabels(filteredProducts, picking, multipliers)
  }

  const totalProducts = filteredProducts.length
  const totalLabels = filteredProducts.reduce((sum, p) => {
    const multiplier = multipliers[p.product_id] ? parseFloat(multipliers[p.product_id]) : 1
    return sum + Math.floor((p.quantity || 0) * multiplier)
  }, 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mt-8"
    >
      {/* Header Section */}
      <div className="glass-strong rounded-3xl p-6 mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-100/24 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl shadow-glow">
                <Layers size={28} className="text-white" />
              </div>
              <div>
                <h2 className="text-3xl font-bold gradient-text">Chi tiết sản phẩm</h2>
                <div className="flex items-center gap-3 mt-2">
                  <Badge variant="info">
                    <Boxes size={14} className="mr-1" />
                    {totalProducts} sản phẩm
                  </Badge>
                  <Badge variant="primary">{totalLabels} labels</Badge>
                </div>
              </div>
            </div>
            {filteredProducts.length > 1 && (
              <Button
                onClick={handlePrintAll}
                variant="success"
                leftIcon={<Printer size={20} />}
                size="lg"
              >
                In tất cả ({filteredProducts.length})
              </Button>
            )}
          </div>

          {/* Product Search */}
          <div className="mt-5">
            <div className="relative group max-w-2xl">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors">
                <Search size={20} />
              </div>
              <input
                type="text"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Tìm sản phẩm trong phiếu (tên / mã / variant / lot...)"
                className="input pl-11 pr-10 py-3"
              />
              {productQuery && (
                <motion.button
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setProductQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center w-7 h-7"
                  type="button"
                >
                  <span className="text-gray-600 text-lg leading-none font-normal">×</span>
                </motion.button>
              )}
            </div>

            {!!productQuery.trim() && (
              <p className="text-sm text-gray-600 mt-2">
                Kết quả:{' '}
                <span className="font-semibold text-gray-900">{filteredProducts.length}</span> /{' '}
                {products.length}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <div className="glass-strong rounded-2xl p-6 text-center text-gray-700">
          Không tìm thấy sản phẩm nào phù hợp.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {filteredProducts.map((product, index) => (
            <motion.div
              key={`${product.product_id}-${index}-${product.product_name}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="h-full"
            >
              <ProductCard
                product={product}
                picking={picking}
                multiplier={multipliers[product.product_id] || ''}
                onMultiplierChange={(value) => handleMultiplierChange(product.product_id, value)}
              />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDateStr(picking) {
  const raw = picking.date_done || picking.scheduled_date
  return raw
    ? new Date(raw).toLocaleDateString('vi-VN')
    : new Date().toLocaleDateString('vi-VN')
}

/** Loại bỏ variant trong ngoặc đơn cuối tên sản phẩm */
function cleanProductName(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

/** Phân bổ lot cho từng label theo tỷ lệ */
function buildLabelItems(product, totalLabels) {
  if (product.lots && product.lots.length > 0) {
    return Array.from({ length: totalLabels }, (_, i) => {
      const lotIndex = Math.min(
        Math.floor((i / totalLabels) * product.lots.length),
        product.lots.length - 1,
      )
      return { lot_name: product.lots[lotIndex]?.lot_name || 'N/A' }
    })
  }
  return Array.from({ length: totalLabels }, () => ({ lot_name: 'N/A' }))
}

const PDF_LAYOUT = {
  pageWidth: 210,
  pageHeight: 297,
  marginX: 5,
  marginY: 5,
  gapX: 2,
  gapY: 2,
  columns: 2,
  rows: 6,
  labelWidth: 96,
  labelHeight: 40,
  labelsPerPage: 12,
}

const PDF_FONT_NAME = 'RobotoLabel'
const PDF_FONT_FILE = 'Roboto-Regular.ttf'

let robotoBase64Promise

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toSafeFilename(value, fallback) {
  const normalized = String(value || fallback).replace(/[^a-zA-Z0-9]/g, '_')
  return normalized || fallback
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function loadRobotoBase64() {
  if (!robotoBase64Promise) {
    robotoBase64Promise = fetch(robotoRegularUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Không tải được font cho PDF.')
        }
        return response.arrayBuffer()
      })
      .then(arrayBufferToBase64)
  }

  return robotoBase64Promise
}

async function createLabelPdfDocument() {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
  })

  const robotoBase64 = await loadRobotoBase64()
  doc.addFileToVFS(PDF_FONT_FILE, robotoBase64)
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, 'normal')
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, 'bold')
  doc.setFont(PDF_FONT_NAME, 'normal')

  return doc
}

function truncateText(doc, value, maxWidth) {
  const text = normalizeText(value)
  if (!text) return ''
  if (doc.getTextWidth(text) <= maxWidth) return text

  const ellipsis = '...'
  let truncated = text

  while (truncated && doc.getTextWidth(`${truncated}${ellipsis}`) > maxWidth) {
    truncated = truncated.slice(0, -1)
  }

  return truncated ? `${truncated}${ellipsis}` : ellipsis
}

function getLabelPosition(index) {
  const slot = index % PDF_LAYOUT.labelsPerPage
  const column = slot % PDF_LAYOUT.columns
  const row = Math.floor(slot / PDF_LAYOUT.columns)

  return {
    x: PDF_LAYOUT.marginX + column * (PDF_LAYOUT.labelWidth + PDF_LAYOUT.gapX),
    y: PDF_LAYOUT.marginY + row * (PDF_LAYOUT.labelHeight + PDF_LAYOUT.gapY),
  }
}

function drawLabel(doc, item, index) {
  const { x, y } = getLabelPosition(index)
  // PDF_LAYOUT.labelWidth = 96, PDF_LAYOUT.labelHeight = 40
  const margin = 4;
  const left = x + margin
  const right = x + PDF_LAYOUT.labelWidth - margin
  const contentWidth = PDF_LAYOUT.labelWidth - margin * 2

  // 1. Label Container (Border)
  // Using rounded rectangle
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.2)
  doc.roundedRect(x, y, PDF_LAYOUT.labelWidth, PDF_LAYOUT.labelHeight, 2, 2)

  // 2. Product Name
  doc.setTextColor(17, 24, 39) 
  doc.setFont(PDF_FONT_NAME, 'bold')
  doc.setFontSize(13)
  doc.text(truncateText(doc, cleanProductName(item.product_name), contentWidth), left, y + 8.5)

  // 3. Variant
  doc.setFont(PDF_FONT_NAME, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(75, 85, 99)
  doc.text(truncateText(doc, item.variant || 'N/A', contentWidth), left, y + 14)

  // 4. Divider Line (Dashed)
  doc.setDrawColor(229, 231, 235)
  doc.setLineWidth(0.3)
  doc.setLineDashPattern([1.5, 1.5], 0)
  doc.line(left, y + 18.5, right, y + 18.5)
  doc.setLineDashPattern([], 0) // Reset to solid for next label

  // 5. Columns for Lot and Date
  const col1Left = left
  const col2Left = left + (contentWidth / 2) + 2

  const bottomYLabel = y + 25.5
  const bottomYValue = y + 32.5

  // Labels (Gray, smaller)
  doc.setFont(PDF_FONT_NAME, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(107, 114, 128)
  doc.text('Lot/SN:', col1Left, bottomYLabel)
  doc.text('Ngày nhận:', col2Left, bottomYLabel)

  // Values (Black, bold)
  doc.setTextColor(17, 24, 39)
  doc.setFont(PDF_FONT_NAME, 'bold')
  doc.setFontSize(11)
  
  const halfWidth = (contentWidth / 2) - 4
  doc.text(truncateText(doc, item.lot_name || 'N/A', halfWidth), col1Left, bottomYValue)
  doc.text(truncateText(doc, item.dateStr, halfWidth), col2Left, bottomYValue)
}

async function runJsPdf(allItems, filename, successMessage) {
  const loadingToastId = toast.loading('Đang tạo PDF...')

  try {
    const doc = await createLabelPdfDocument()

    allItems.forEach((item, index) => {
      if (index > 0 && index % PDF_LAYOUT.labelsPerPage === 0) {
        doc.addPage()
      }

      drawLabel(doc, item, index)
    })

    doc.save(filename)
    toast.success(successMessage, { id: loadingToastId })
  } catch (error) {
    console.error('[PDF Error]', error)
    toast.error(`Lỗi khi tạo PDF: ${error.message}`, { id: loadingToastId })
  }
}

// ─── Exported print functions ─────────────────────────────────────────────────

export async function printLabels(product, picking, multiplier = 1) {
  const dateStr = getDateStr(picking)
  const totalLabels = Math.floor((product.quantity || 0) * multiplier)

  if (totalLabels === 0) {
    toast.error('Số lượng label = 0. Kiểm tra lại quantity và multiplier.')
    return
  }

  const allItems = buildLabelItems(product, totalLabels).map((item) => ({
    product_name: product.product_name,
    variant: product.variant || null,
    lot_name: item.lot_name,
    dateStr,
  }))

  const filename = `Labels_${toSafeFilename(product.product_name, 'Product')}_${Date.now()}.pdf`
  await runJsPdf(allItems, filename, `Đã tạo PDF với ${totalLabels} labels`)
}

async function printAllLabels(products, picking, multipliers = {}) {
  const dateStr = getDateStr(picking)
  const allItems = []

  products.forEach((product) => {
    const multiplier = multipliers[product.product_id]
      ? parseFloat(multipliers[product.product_id])
      : 1
    const totalLabels = Math.floor((product.quantity || 0) * multiplier)
    buildLabelItems(product, totalLabels).forEach((item) => {
      allItems.push({
        product_name: product.product_name,
        variant: product.variant || null,
        lot_name: item.lot_name,
        dateStr,
      })
    })
  })

  if (allItems.length === 0) {
    toast.error('Không có label nào để in.')
    return
  }

  const filename = `Labels_All_${toSafeFilename(picking.name || 'Picking', 'Picking')}_${Date.now()}.pdf`
  await runJsPdf(allItems, filename, `Đã tạo 1 file PDF với ${allItems.length} labels`)
}
