import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Search, Save, ClipboardList, AlertCircle, ArrowLeft, List, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { usePickingData } from '../hooks/usePickingData'
import { checkQcExists, saveQcBatch, addProductsToBatch } from '../services/qcApi'

const STATUS_CONFIG = {
  pending: { label: 'Chờ QC', color: 'text-gray-500', bg: 'bg-gray-100', icon: Clock },
  passed: { label: 'Đạt', color: 'text-green-600', bg: 'bg-green-100', icon: CheckCircle },
  failed: { label: 'Lỗi', color: 'text-red-600', bg: 'bg-red-100', icon: XCircle },
  warning: { label: 'Cảnh báo', color: 'text-yellow-600', bg: 'bg-yellow-100', icon: AlertTriangle },
}

export default function QcSearchPage() {
  const navigate = useNavigate()
  const [pickingCode, setPickingCode] = useState('')
  const [searchCode, setSearchCode] = useState('')
  const [selectedIndices, setSelectedIndices] = useState(new Set())
  const [qcQuantities, setQcQuantities] = useState({}) // {product_id: customQty}
  const [batchNotes, setBatchNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // Existing batch data for sync
  const [existingBatch, setExistingBatch] = useState(null)
  const [productStatuses, setProductStatuses] = useState({}) // {product_id: {qc_status, item_id, notes}}

  const { data, isLoading, error } = usePickingData(searchCode)

  // When data loads, check if picking exists in QC
  useEffect(() => {
    if (data?.picking) {
      checkExisting(data.picking.id)
    }
  }, [data])

  async function checkExisting(pickingId) {
    try {
      const result = await checkQcExists(pickingId)
      if (result.exists) {
        setExistingBatch(result.batch)
        setBatchNotes(result.batch.notes || '')

        // Build status map: product_id -> {qc_status, item_id, notes, quantity}
        // Aggregate quantity if same product appears multiple times
        const statusMap = {}
        result.batch.items.forEach(item => {
          if (statusMap[item.product_id]) {
            statusMap[item.product_id].quantity += (item.quantity || 0)
          } else {
            statusMap[item.product_id] = {
              qc_status: item.qc_status,
              item_id: item.id,
              notes: item.notes || '',
              quantity: item.quantity || 0,
            }
          }
        })
        setProductStatuses(statusMap)

        // Pre-select products with remaining quantity (not yet fully batched)
        if (data?.products) {
          const selectableIndices = data.products
            .map((_, idx) => idx)
            .filter(idx => {
              const p = data.products[idx]
              const existing = statusMap[p?.product_id]
              if (!existing) return true
              return (p?.quantity || 0) - (existing.quantity || 0) > 0
            })
          setSelectedIndices(new Set(selectableIndices))
        }
      } else {
        setExistingBatch(null)
        setProductStatuses({})
        setSelectedIndices(new Set())
      }
    } catch (err) {
      console.error('Check existing error:', err)
    }
  }

  const handleSearch = () => {
    if (pickingCode.trim()) {
      setSearchCode(pickingCode.trim())
      setSelectedIndices(new Set())
      setQcQuantities({})
      setBatchNotes('')
      setExistingBatch(null)
      setProductStatuses({})
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleSearch()
  }

  const toggleProduct = (idx, product) => {
    setSelectedIndices(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
        // Default qty = remaining (for partial products) or full qty
        setQcQuantities(prevQty => {
          if (!prevQty[product.product_id]) {
            const existingQty = productStatuses[product.product_id]?.quantity || 0
            const remaining = product.quantity - existingQty
            return { ...prevQty, [product.product_id]: remaining > 0 ? remaining : product.quantity }
          }
          return prevQty
        })
      }
      return next
    })
  }

  const handleQtyChange = (productId, value, maxQty) => {
    if (value === '') {
      setQcQuantities(prev => ({ ...prev, [productId]: '' }))
      return
    }
    const parsed = parseFloat(value)
    if (!isNaN(parsed) && parsed > maxQty) {
      setQcQuantities(prev => ({ ...prev, [productId]: maxQty }))
      return
    }
    setQcQuantities(prev => ({ ...prev, [productId]: value }))
  }

  const selectAll = () => {
    if (data?.products) {
      // Include not-in-batch + partially-batched products (with remaining qty)
      const selectable = data.products
        .map((_, i) => i)
        .filter(i => {
          const p = data.products[i]
          const existing = productStatuses[p?.product_id]
          if (!existing) return true
          return (p?.quantity || 0) - (existing.quantity || 0) > 0
        })
      setSelectedIndices(new Set(selectable))
      // Init default quantities: remaining for partial, full for new
      const newQty = {}
      selectable.forEach(i => {
        const p = data.products[i]
        if (p) {
          const existingQty = productStatuses[p.product_id]?.quantity || 0
          const remaining = p.quantity - existingQty
          newQty[p.product_id] = remaining > 0 ? remaining : p.quantity
        }
      })
      setQcQuantities(prev => ({ ...prev, ...newQty }))
    }
  }

  const deselectAll = () => {
    setSelectedIndices(new Set())
  }

  const handleSave = async () => {
    if (selectedIndices.size === 0) {
      toast.error('Chọn ít nhất 1 sản phẩm để QC')
      return
    }
    if (!data?.picking) return

    const products = data.products
      .filter((_, i) => selectedIndices.has(i))
      .map(p => {
        const rawQty = qcQuantities[p.product_id]
        let finalQty = p.quantity
        if (rawQty !== undefined && rawQty !== '') {
          finalQty = parseFloat(rawQty)
          if (isNaN(finalQty) || finalQty < 0) finalQty = p.quantity
        }
        return {
          ...p,
          quantity: finalQty,
        }
      })

    setSaving(true)
    try {
      if (existingBatch) {
        // Add products to existing batch
        const result = await addProductsToBatch({
          pickingId: data.picking.id,
          products,
        })

        if (result.added === 0) {
          toast.info('Tất cả sản phẩm đã có trong QC list')
        } else {
          toast.success(`Đã thêm ${result.added} sản phẩm vào QC batch #${existingBatch.id}`)
        }
      } else {
        // Create new batch
        await saveQcBatch({
          picking: data.picking,
          products,
          notes: batchNotes,
        })
        toast.success(`Đã lưu ${products.length} sản phẩm vào QC List!`)
      }

      // Reload existing data to sync
      await checkExisting(data.picking.id)
      setSelectedIndices(new Set())
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Lỗi khi lưu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen py-8 px-4 relative overflow-hidden">
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-100/40 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Back + Nav */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/')} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
            <ArrowLeft size={22} />
          </button>
          <button onClick={() => navigate('/qc-list')} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl flex items-center gap-2 transition-colors text-sm font-medium">
            <List size={16} />
            Xem QC List
          </button>
        </motion.div>

        {/* Header */}
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="inline-block mb-4">
            <div className="p-4 bg-gradient-to-br from-orange-500/20 via-red-500/20 to-pink-500/20 rounded-3xl backdrop-blur-xl border border-white/10 inline-block">
              <div className="p-3 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl">
                <span className="text-4xl">🔍</span>
              </div>
            </div>
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-bold mb-3" style={{ background: 'linear-gradient(135deg, #f97316, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            QC List — Tìm Phiếu
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Tìm kiếm phiếu từ Odoo → Chọn sản phẩm cần kiểm tra → Lưu vào QC List
          </p>
        </motion.header>

        {/* Existing Batch Banner */}
        {existingBatch && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-2xl p-4 mb-4 bg-blue-50/50 border-blue-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-xl">
                <ClipboardList size={20} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800">
                  Phiếu này đã có trong QC List — <strong>Batch #{existingBatch.id}</strong>
                </p>
                <p className="text-xs text-blue-600">
                  Trạng thái: <strong>{existingBatch.overall_status}</strong> · {existingBatch.selected_count} sản phẩm · Chỉ thêm sản phẩm mới
                </p>
              </div>
              <button
                onClick={() => navigate(`/qc-detail/${existingBatch.id}`)}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Xem chi tiết
              </button>
            </div>
          </motion.div>
        )}

        {/* Search */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-3xl p-6 shadow-2xl mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl">
              <Search size={20} className="text-white" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">Tìm kiếm phiếu</h2>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={pickingCode}
              onChange={(e) => setPickingCode(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Nhập mã phiếu hoặc ID (VD: WH/IN/00001 hoặc 12345)"
              className="input flex-1 px-4 py-3 text-lg"
            />
            <button
              onClick={handleSearch}
              disabled={!pickingCode.trim() || isLoading}
              className="px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-orange-600 hover:to-red-600 transition-all"
            >
              Tìm
            </button>
          </div>
        </motion.div>

        {isLoading && <LoadingSpinner />}

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-strong rounded-2xl p-6 border-red-200 bg-red-50/50 mb-6">
            <div className="flex items-center gap-3">
              <AlertCircle size={24} className="text-red-500" />
              <p className="text-red-700">{error.message}</p>
            </div>
          </motion.div>
        )}

        {/* Products Selection */}
        {data?.products && data.products.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl">
                  <ClipboardList size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Sản phẩm trong phiếu</h2>
                  <p className="text-sm text-gray-500">
                    {data.picking.name} — {data.picking.partner}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={selectAll} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                  Chọn sản phẩm mới
                </button>
                <button onClick={deselectAll} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.products.map((product, idx) => {
                const productStatus = productStatuses[product.product_id]
                const qcQty = productStatus?.quantity ?? 0
                const remainingQty = Math.max(0, product.quantity - qcQty)
                const isFullyInBatch = !!productStatus && remainingQty <= 0
                const isPartiallyInBatch = !!productStatus && remainingQty > 0
                const isAlreadyInBatch = isFullyInBatch
                const isSelectable = selectedIndices.has(idx)
                const statusInfo = productStatus ? STATUS_CONFIG[productStatus.qc_status] || STATUS_CONFIG.pending : null
                const StatusIcon = statusInfo?.icon

                return (
                  <motion.div
                    key={`${product.product_id}-${idx}-${product.product_name}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      isFullyInBatch
                        ? 'border-blue-300 bg-blue-50/30'
                        : isPartiallyInBatch
                          ? isSelectable
                            ? 'border-orange-500 bg-orange-50/50 shadow-md'
                            : 'border-yellow-300 bg-yellow-50/30 cursor-pointer'
                          : isSelectable
                            ? 'border-orange-500 bg-orange-50/50 shadow-md'
                            : 'border-gray-200 bg-white hover:border-gray-300 cursor-pointer'
                    }`}
                    onClick={() => !isFullyInBatch && toggleProduct(idx, product)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox or Status Badge */}
                      {isAlreadyInBatch ? (
                        <div className={`mt-0.5 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${statusInfo.bg} ${statusInfo.color}`}>
                          <StatusIcon size={12} />
                          {statusInfo.label}
                        </div>
                      ) : isPartiallyInBatch ? (
                        <div className="mt-0.5 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 bg-yellow-100 text-yellow-700">
                          <StatusIcon size={12} />
                          {statusInfo.label}
                        </div>
                      ) : (
                        <div className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          isSelectable ? 'bg-orange-500 border-orange-500' : 'border-gray-300'
                        }`}>
                          {isSelectable && <CheckCircle size={16} className="text-white" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {product.product_name}
                          {isFullyInBatch && <span className="ml-2 text-xs text-blue-500 font-normal">(đã QC đủ)</span>}
                          {isPartiallyInBatch && <span className="ml-2 text-xs text-yellow-600 font-normal">(đã QC một phần)</span>}
                        </p>
                        {product.variant && (
                          <p className="text-sm text-gray-500 truncate">{product.variant}</p>
                        )}
                        <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-600 items-center">
                          <span>Mã: <strong>{product.product_id}</strong></span>
                          {isFullyInBatch ? (
                            <span className="text-green-600">✅ Đã QC: <strong>{qcQty}</strong> {product.uom}</span>
                          ) : isPartiallyInBatch ? (
                            <>
                              <span className="text-blue-600">Đã QC: <strong>{qcQty}</strong></span>
                              <span className="text-orange-500 font-medium">Còn lại: <strong>{remainingQty}</strong> {product.uom}</span>
                              {isSelectable && (
                                <span className="flex items-center gap-1">
                                  SL thêm:
                                  <input
                                    type="number"
                                    min="0.01"
                                    max={remainingQty}
                                    step="1"
                                    value={qcQuantities[product.product_id] ?? remainingQty}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => handleQtyChange(product.product_id, e.target.value, remainingQty)}
                                    className="w-20 px-2 py-0.5 border border-orange-400 rounded-lg text-center font-semibold text-orange-700 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                                  />
                                  <span className="text-gray-400">/ {remainingQty} {product.uom}</span>
                                </span>
                              )}
                            </>
                          ) : isSelectable ? (
                            <span className="flex items-center gap-1">
                              SL QC:
                              <input
                                type="number"
                                min="0.01"
                                max={product.quantity}
                                step="1"
                                value={qcQuantities[product.product_id] ?? product.quantity}
                                onClick={e => e.stopPropagation()}
                                onChange={e => handleQtyChange(product.product_id, e.target.value, product.quantity)}
                                className="w-20 px-2 py-0.5 border border-orange-400 rounded-lg text-center font-semibold text-orange-700 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                              />
                              <span className="text-gray-400">/ {product.quantity} {product.uom}</span>
                            </span>
                          ) : (
                            <span>SL: <strong>{product.quantity}</strong> {product.uom}</span>
                          )}
                        </div>
                        {product.lots && product.lots.length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            Lots: {product.lots.map(l => l.lot_name).join(', ')}
                          </p>
                        )}
                        {/* Show existing notes */}
                        {isAlreadyInBatch && productStatus.notes && (
                          <p className="text-xs text-gray-500 mt-1 italic">📝 {productStatus.notes}</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            {/* Save Button */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {existingBatch ? (
                  <>
                    Thêm mới: <strong className="text-orange-600">{selectedIndices.size}</strong> / {data.products.length - Object.keys(productStatuses).length} sản phẩm chưa có
                  </>
                ) : (
                  <>
                    Đã chọn: <strong className="text-orange-600">{selectedIndices.size}</strong> / {data.products.length} sản phẩm
                  </>
                )}
              </p>
              <button
                onClick={handleSave}
                disabled={selectedIndices.size === 0 || saving}
                className="px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-orange-600 hover:to-red-600 transition-all flex items-center gap-2"
              >
                <Save size={18} />
                {saving ? 'Đang lưu...' : existingBatch ? `Thêm ${selectedIndices.size} sản phẩm mới` : 'Lưu vào QC List'}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
