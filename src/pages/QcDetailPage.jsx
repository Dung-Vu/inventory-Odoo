import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, FileText, CheckCircle, XCircle, AlertTriangle, Clock, Edit3, List } from 'lucide-react'
import { jsPDF } from 'jspdf'
import toast from 'react-hot-toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { fetchQcDetail, updateQcItem, updateQcNotes } from '../services/qcApi'
import robotoRegularUrl from '../fonts/Roboto-Regular.ttf?url'

// ── PDF Font config (same as ProductsList.jsx) ──
const QC_FONT_NAME = 'RobotoQC'
const QC_FONT_FILE = 'Roboto-Regular.ttf'

let qcRobotoBase64Promise

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
  if (!qcRobotoBase64Promise) {
    qcRobotoBase64Promise = fetch(robotoRegularUrl)
      .then((response) => {
        if (!response.ok) throw new Error('Không tải được font cho PDF.')
        return response.arrayBuffer()
      })
      .then(arrayBufferToBase64)
  }
  return qcRobotoBase64Promise
}

async function createQcPdfDocument() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true, putOnlyUsedFonts: true })
  const robotoBase64 = await loadRobotoBase64()
  doc.addFileToVFS(QC_FONT_FILE, robotoBase64)
  doc.addFont(QC_FONT_FILE, QC_FONT_NAME, 'normal')
  doc.addFont(QC_FONT_FILE, QC_FONT_NAME, 'bold')
  doc.setFont(QC_FONT_NAME, 'normal')
  return doc
}

const STATUS_OPTIONS = [
  { key: 'pending', label: 'Chờ QC', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: Clock },
  { key: 'passed', label: 'Đạt', color: 'bg-green-100 text-green-700 border-green-300', icon: CheckCircle },
  { key: 'failed', label: 'Lỗi', color: 'bg-red-100 text-red-700 border-red-300', icon: XCircle },
  { key: 'warning', label: 'Cảnh báo', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: AlertTriangle },
]

export default function QcDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [batch, setBatch] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [editingItemId, setEditingItemId] = useState(null)
  const [editNotes, setEditNotes] = useState('')

  const loadDetail = async () => {
    setLoading(true)
    try {
      const data = await fetchQcDetail(parseInt(id))
      setBatch(data)
      setNotesText(data.notes || '')
    } catch (err) {
      toast.error('Lỗi tải chi tiết QC')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetail()
  }, [id])

  const handleStatusChange = async (itemId, newStatus) => {
    try {
      await updateQcItem(itemId, { qc_status: newStatus })
      await loadDetail()
      toast.success('Đã cập nhật')
    } catch (err) {
      toast.error('Lỗi khi cập nhật')
    }
  }

  const handleNotesSave = async () => {
    try {
      await updateQcNotes(parseInt(id), notesText)
      setEditingNotes(false)
      await loadDetail()
      toast.success('Đã lưu ghi chú')
    } catch (err) {
      toast.error('Lỗi khi lưu')
    }
  }

  const handleItemNotesSave = async (itemId) => {
    try {
      await updateQcItem(itemId, { notes: editNotes })
      setEditingItemId(null)
      setEditNotes('')
      await loadDetail()
      toast.success('Đã lưu ghi chú')
    } catch (err) {
      toast.error('Lỗi khi lưu')
    }
  }

  // Parse variant into size and color (matches Odoo display)
  const parseVariant = (variant) => {
    if (!variant) return { size: '', color: '' }
    const v = String(variant).trim()

    // Strip common Odoo prefixes: "Size:", "Fabric(s)", "Color(s)" with or without ":"
    let cleaned = v
      .replace(/\b(Size|Fabrics?|Colors?|Colours?)\s*:\s*/gi, '')
      .replace(/\b(Fabrics?|Colors?|Colours?)\s+/gi, '')  // strip keywords without ":"
      .replace(/[|]/g, ' ')  // replace pipe with space
      .replace(/\s{2,}/g, ' ')  // normalize multiple spaces
      .trim()

    // Match full dimension patterns: W825-D900-H750
    const sizeMatch = cleaned.match(/W\d{2,4}-D\d{2,4}-H\d{2,4}/i)
    if (sizeMatch) {
      const size = sizeMatch[0]
      const rest = cleaned.replace(size, '').trim()
        .replace(/^[-–—|]+\s*/, '').replace(/\s*[-–—|]+$/, '')
        .trim()
      return { size, color: rest }
    }

    // Match simple size: 50x50, 50x50x10
    const simpleSize = cleaned.match(/\d{1,4}[x×]\d{1,4}(?:[x×]\d{1,4})?/)
    if (simpleSize) {
      const size = simpleSize[0]
      const rest = cleaned.replace(size, '').trim()
        .replace(/^[-–—|]+\s*/, '').replace(/\s*[-–—|]+$/, '')
        .trim()
      return { size, color: rest }
    }

    // No size pattern found — entire cleaned variant is color
    return { size: '', color: cleaned }
  }

  // PDF Export — styled like Odoo QC LIST report
  const handleExportPdf = useCallback(async () => {
    if (!batch) return

    const pendingItems = batch.items.filter(item => item.qc_status === 'pending')
    if (pendingItems.length === 0) {
      toast.info('Không có sản phẩm nào cần QC')
      return
    }

    const loadingToast = toast.loading('Đang tạo PDF...')

    try {
      const doc = await createQcPdfDocument()
      const pageWidth = 210
      const margin = 12
      const contentWidth = pageWidth - margin * 2
      let y = 15

      // ── HEADER: ORDINAIRE brand ──
      doc.setFontSize(8)
      doc.setTextColor(100, 100, 100)
      doc.setFont(QC_FONT_NAME, 'bold')
      // Spaced-out "ORDINAIRE"
      const ordText = 'O R D I N A I R E'
      doc.text(ordText, margin, y)
      y += 5
      doc.setFontSize(9)
      doc.text('Ordinaire Vietnam', margin, y)

      // ── TITLE: QC LIST (centered, bold, underlined) ──
      doc.setFontSize(20)
      doc.setTextColor(0, 0, 0)
      doc.setFont(QC_FONT_NAME, 'bold')
      doc.text('QC LIST', pageWidth / 2, y, { align: 'center' })
      // Underline
      const titleWidth = doc.getTextWidth('QC LIST')
      const titleX = (pageWidth - titleWidth) / 2
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.5)
      doc.line(titleX, y + 1, titleX + titleWidth, y + 1)
      doc.setLineWidth(0.2)
      y += 10

      // ── DATE ROW ──
      doc.setFontSize(9)
      doc.setFont(QC_FONT_NAME, 'normal')
      const qcDate = new Date().toLocaleDateString('vi-VN')
      doc.text(`NGÀY QC: ${qcDate}`, margin, y)

      // Center box (empty rectangle)
      const boxW = 50
      const boxH = 8
      const boxX = (pageWidth - boxW) / 2
      doc.rect(boxX, y - 5, boxW, boxH)

      // Đơn nhận (receipt order) on right
      doc.text(`ĐƠN NHẬN: ${batch.picking_name}`, pageWidth - margin, y, { align: 'right' })
      y += 10

      // ── NHÀ CUNG CẤP ──
      doc.text(`NHÀ CUNG CẤP: ${batch.partner || ''}`, margin, y)
      y += 10

      // ── TABLE ──
      // 9 columns matching Odoo template - optimized for long product names
      const cols = [
        { x: margin, w: 10, header: 'STT' },
        { x: margin + 10, w: 70, header: 'TÊN SP & KÍCH THƯỚC' },
        { x: margin + 80, w: 15, header: 'LOTS' },
        { x: margin + 95, w: 14, header: 'SL ĐẶT' },
        { x: margin + 109, w: 15, header: 'MÀU' },
        { x: margin + 124, w: 17, header: 'SL NHẬN' },
        { x: margin + 141, w: 12, header: 'ĐẠT' },
        { x: margin + 153, w: 20, header: 'KHÔNG ĐẠT' },
        { x: margin + 173, w: 13, header: 'NOTE' },
      ]
      const tableWidth = contentWidth
      const headerH = 12
      const rowH = 14

      // Draw table header
      doc.setFillColor(240, 240, 240)
      doc.rect(margin, y, tableWidth, headerH, 'F')
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.3)
      doc.rect(margin, y, tableWidth, headerH, 'S')

      doc.setFontSize(7)
      doc.setFont(QC_FONT_NAME, 'bold')
      // Centered vertically: headerH/2 + font baseline offset
      const headerY = y + headerH / 2 + 1.5
      cols.forEach(col => {
        // Centered horizontally
        const textWidth = doc.getTextWidth(col.header)
        const textX = col.x + (col.w - textWidth) / 2
        doc.text(col.header, textX, headerY)
        // Vertical lines
        if (col.x > margin) {
          doc.line(col.x, y, col.x, y + headerH)
        }
      })
      y += headerH

      // ── TABLE DATA ROWS ──
      doc.setFont(QC_FONT_NAME, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(0, 0, 0)

      // Show all items (not just pending) to match full list
      const allItems = batch.items
      const maxRows = Math.max(allItems.length, 10) // At least 10 rows like template

      for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
        // New page if needed
        if (y + rowH > 255) {
          doc.addPage()
          y = 15
          // Redraw header
          doc.setFillColor(240, 240, 240)
          doc.rect(margin, y, tableWidth, headerH, 'F')
          doc.setDrawColor(0, 0, 0)
          doc.rect(margin, y, tableWidth, headerH, 'S')
          doc.setFont(QC_FONT_NAME, 'bold')
          doc.setFontSize(7)
          const newHeaderY = y + headerH / 2 + 1.5
          cols.forEach(col => {
            const textWidth = doc.getTextWidth(col.header)
            const textX = col.x + (col.w - textWidth) / 2
            doc.text(col.header, textX, newHeaderY)
            if (col.x > margin) doc.line(col.x, y, col.x, y + headerH)
          })
          doc.setFont(QC_FONT_NAME, 'normal')
          doc.setFontSize(8)
          y += headerH
        }

        const item = allItems[rowIdx]

        // Row border
        doc.rect(margin, y, tableWidth, rowH, 'S')

        // Vertical lines
        cols.forEach(col => {
          if (col.x > margin) {
            doc.line(col.x, y, col.x, y + rowH)
          }
        })

        if (item) {
          // STT
          doc.text(String(rowIdx + 1), cols[0].x + cols[0].w / 2, y + 5, { align: 'center' })

          // TÊN SP & KÍCH THƯỚC — wrap text nếu dài
          const prodName = item.product_name || ''
          const maxCharsPerLine = 38 // ~70mm with 8pt font
          let nameLines = []
          if (prodName.length > maxCharsPerLine) {
            // Split by '-' for module names
            const parts = prodName.split('-')
            let currentLine = ''
            for (const part of parts) {
              const testLine = currentLine ? `${currentLine}-${part}` : part
              if (testLine.length > maxCharsPerLine && currentLine) {
                nameLines.push(currentLine)
                currentLine = part
              } else {
                currentLine = testLine
              }
            }
            if (currentLine) nameLines.push(currentLine)
          } else {
            nameLines = [prodName.substring(0, maxCharsPerLine)]
          }
          // Render max 2 lines for product name
          doc.text(nameLines[0] || '', cols[1].x + 1, y + 5)
          if (nameLines.length > 1) {
            doc.text(nameLines[1] || '', cols[1].x + 1, y + 9)
          }

          // Parse variant → hiển thị size ở dòng 2 (font nhỏ, xám)
          const { size, color } = parseVariant(item.variant)
          if (size) {
            doc.setFontSize(6)
            doc.setTextColor(120, 120, 120)
            // Nếu có 2 dòng tên SP thì size xuống dưới, ngược lại vẫn ở y+10
            const sizeY = nameLines.length > 1 ? y + 12.5 : y + 10
            doc.text(size, cols[1].x + 1, sizeY)
            doc.setFontSize(8)
            doc.setTextColor(0, 0, 0)
          }

          // LOTS
          const lots = item.lots ? JSON.parse(item.lots).map(l => l.lot_name || '').join(', ').substring(0, 12) : ''
          doc.text(lots, cols[2].x + 1, y + 5)

          // SL ĐẶT — center chính xác trong cột
          const qtyText = Number(item.quantity || 0).toFixed(2)
          doc.text(qtyText, cols[3].x + cols[3].w / 2, y + 5, { align: 'center' })

          // MÀU — chỉ hiển thị color từ variant
          const colorText = color.substring(0, 12)
          doc.text(colorText, cols[4].x + 1, y + 5)

          // SL NHẬN — center chính xác trong cột
          doc.text(qtyText, cols[5].x + cols[5].w / 2, y + 5, { align: 'center' })

          // ĐẠT / KHÔNG ĐẠT
          if (item.qc_status === 'passed') doc.text('x', cols[6].x + 5, y + 5)
          if (item.qc_status === 'failed') doc.text('x', cols[7].x + 5, y + 5)

          // NOTE
          const note = (item.notes || '').substring(0, 10)
          doc.text(note, cols[8].x + 1, y + 5)
        }

        y += rowH
      }

      // ── SIGNATURE SECTION ──
      y += 12
      if (y > 255) {
        doc.addPage()
        y = 20
      }

      const sigWidth = 55
      const sigGap = (contentWidth - sigWidth * 3) / 2
      const signatures = [
        { title: 'Người kiểm tra', sub: '(Ký và ghi rõ họ tên)' },
        { title: 'Người phụ trách kho', sub: '(Ký và ghi rõ họ tên)' },
        { title: 'Quản lý', sub: '(Ký và ghi rõ họ tên)' },
      ]

      signatures.forEach((sig, i) => {
        const x = margin + i * (sigWidth + sigGap)
        // Title
        doc.setFontSize(8)
        doc.setFont(QC_FONT_NAME, 'bold')
        doc.text(sig.title, x + sigWidth / 2, y, { align: 'center' })
        // Sub text
        doc.setFont(QC_FONT_NAME, 'normal')
        doc.setFontSize(7)
        doc.text(sig.sub, x + sigWidth / 2, y + 22, { align: 'center' })
      })

      // ── FOOTER: Page 1 / 1 ──
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.2)
      doc.line(margin, 282, pageWidth - margin, 282)
      doc.setFontSize(7)
      doc.setTextColor(150, 150, 150)
      doc.text('Page 1 / 1', margin, 286)

      doc.save(`QC_List_${batch.picking_name}_${Date.now()}.pdf`)
      toast.success('Đã tạo PDF thành công', { id: loadingToast })
    } catch (err) {
      console.error('[QC PDF Error]', err)
      toast.error('Lỗi khi tạo PDF: ' + err.message, { id: loadingToast })
    }
  }, [batch])

  if (loading) return <LoadingSpinner />
  if (!batch) return <div className="p-8 text-center text-gray-500">Không tìm thấy QC batch</div>

  const overallStatus = STATUS_OPTIONS.find(s => s.key === batch.overall_status) || STATUS_OPTIONS[0]
  const OverallIcon = overallStatus.icon

  const pendingItems = batch.items.filter(item => item.qc_status === 'pending')

  return (
    <div className="min-h-screen py-8 px-4 relative overflow-hidden">
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-teal-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-cyan-100/40 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-5xl mx-auto relative z-10">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/qc-list')} className="p-2 hover:bg-white/60 rounded-xl transition-colors">
            <ArrowLeft size={22} />
          </button>
          <button onClick={() => navigate('/qc-search')} className="px-4 py-2 bg-white/60 hover:bg-white/80 rounded-xl flex items-center gap-2 transition-colors text-sm font-medium">
            <List size={16} />
            Thêm phiếu
          </button>
          <div className="flex-1">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{batch.picking_name}</h1>
              <p className="text-sm text-gray-500">{batch.partner}</p>
            </div>
          </div>
          <div className="flex-1"></div>
          <div className="flex gap-2">
            <button
              onClick={handleExportPdf}
              className="px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl font-medium flex items-center gap-2 hover:from-teal-600 hover:to-cyan-600 transition-all"
            >
              <FileText size={18} />
              Export PDF ({pendingItems.length})
            </button>
          </div>
        </motion.div>

        {/* Picking Info */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-3xl p-6 mb-6">
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
              <span className="text-gray-500">Trạng thái:</span>{' '}
              <span className={`font-semibold ${overallStatus.color.split(' ')[1]}`}>
                <OverallIcon size={14} className="inline mr-1" />
                {overallStatus.label}
              </span>
            </div>
            <div className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
              <span className="text-gray-500">Loại:</span> <strong>{batch.picking_type || 'N/A'}</strong>
            </div>
            <div className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
              <span className="text-gray-500">Ngày:</span> <strong>{batch.scheduled_date ? new Date(batch.scheduled_date).toLocaleDateString('vi-VN') : 'N/A'}</strong>
            </div>
            <div className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
              <span className="text-gray-500">SP cần QC:</span> <strong>{pendingItems.length}</strong> / {batch.selected_count}
            </div>
          </div>

          {/* Batch Notes */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Ghi chú batch</label>
              {!editingNotes ? (
                <button onClick={() => { setEditingNotes(true); setNotesText(batch.notes || '') }} className="p-1 text-gray-400 hover:text-indigo-600">
                  <Edit3 size={16} />
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={handleNotesSave} className="px-3 py-1 text-sm bg-green-500 text-white rounded-lg">Lưu</button>
                  <button onClick={() => { setEditingNotes(false); setNotesText(batch.notes || '') }} className="px-3 py-1 text-sm bg-gray-200 rounded-lg">Hủy</button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                rows={2}
              />
            ) : (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{batch.notes || 'Chưa có ghi chú'}</p>
            )}
          </div>
        </motion.div>

        {/* Items */}
        <div className="space-y-3">
          {batch.items.map((item, i) => {
            const itemStatus = STATUS_OPTIONS.find(s => s.key === item.qc_status) || STATUS_OPTIONS[0]
            const ItemIcon = itemStatus.icon
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-strong rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900">{item.product_name}</h3>
                    {item.variant && <p className="text-sm text-gray-500">{item.variant}</p>}
                    <div className="flex gap-3 mt-1 text-sm text-gray-600">
                      <span>Mã: <strong>{item.product_id}</strong></span>
                      <span>SL: <strong>{item.quantity}</strong> {item.uom}</span>
                    </div>
                    {item.lots && (
                      <p className="text-xs text-gray-400 mt-1">Lots: {JSON.parse(item.lots || '[]').map(l => l.lot_name).join(', ')}</p>
                    )}
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full border flex items-center gap-1 ${itemStatus.color}`}>
                    <ItemIcon size={12} />
                    {itemStatus.label}
                  </span>
                </div>

                {/* Status Buttons */}
                <div className="flex gap-2 mb-3">
                  {STATUS_OPTIONS.map(opt => {
                    const OptIcon = opt.icon
                    const isActive = item.qc_status === opt.key
                    return (
                      <button
                        key={opt.key}
                        onClick={() => handleStatusChange(item.id, opt.key)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 ${
                          isActive
                            ? opt.color + ' ring-2 ring-offset-1 ring-gray-300'
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <OptIcon size={12} />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>

                {/* Item Notes */}
                <div>
                  {editingItemId === item.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Ghi chú lỗi / vấn đề..."
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button onClick={() => handleItemNotesSave(item.id)} className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg">Lưu</button>
                      <button onClick={() => { setEditingItemId(null); setEditNotes('') }} className="px-3 py-1.5 text-sm bg-gray-200 rounded-lg">Hủy</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 truncate">
                        {item.notes || 'Chưa có ghi chú'}
                      </p>
                      <button
                        onClick={() => { setEditingItemId(item.id); setEditNotes(item.notes || '') }}
                        className="p-1 text-gray-400 hover:text-indigo-600"
                      >
                        <Edit3 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
