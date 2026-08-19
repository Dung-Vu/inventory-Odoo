import { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  Eye,
  CheckCircle2,
  Tag,
  AlertTriangle,
  PackageCheck,
  Hash,
  ListChecks,
} from 'lucide-react'
import toast from 'react-hot-toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { previewLots, applyLots } from '../services/generateLotsApi'

const STATE_LABEL = {
  draft: 'Nháp',
  confirmed: 'Xác nhận',
  waiting: 'Chờ',
  assigned: 'Đã reserve',
  partially_available: 'Có một phần',
  done: 'Hoàn thành',
  cancel: 'Đã hủy',
}

export default function GenerateLotsPage() {
  const navigate = useNavigate()
  const [pickingName, setPickingName] = useState('')
  const [previewData, setPreviewData] = useState(null)
  const [applyData, setApplyData] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [previewInput, setPreviewInput] = useState('')

  const handlePreview = async () => {
    if (!pickingName.trim()) {
      toast.error('Vui lòng nhập mã phiếu')
      return
    }
    setError(null)
    setApplyData(null)
    setPreviewLoading(true)
    try {
      const data = await previewLots(pickingName.trim())
      setPreviewData(data)
      setPreviewInput(pickingName.trim())
      if (data.can_apply && data.total_done_mos_to_prepare > 0) {
        toast.success(
          `Sẽ chuẩn hóa serial và chuẩn bị ${data.total_done_mos_to_prepare} MO đã Done để phiếu có thể Validate`
        )
      } else if (data.can_apply && data.total_to_rename > 0) {
        toast.success(
          `Sẽ chuẩn hóa tên ${data.total_to_rename} lot nguồn MO và gán ${data.total_to_assign} serial`
        )
      } else if (data.can_apply && data.total_to_create === 0) {
        toast.success(`Sẽ gán ${data.total_to_assign} lot nguồn vào Detail, không tạo lot mới`)
      } else if (data.total_to_create === 0) {
        toast(data.message || 'Không có lot nào cần tạo hoặc gán', { icon: 'ℹ️' })
      } else {
        toast.success(
          `Sẽ tạo ${data.total_to_create} lot và gán ${data.total_to_assign} serial${data.total_skipped > 0 ? ` (bỏ qua ${data.total_skipped} đã có)` : ''}`
        )
      }
    } catch (err) {
      setError(err.message || 'Lỗi khi tải preview')
      setPreviewData(null)
      toast.error(err.message || 'Lỗi khi tải preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleApply = async () => {
    if (!previewData?.picking?.id || previewInput !== pickingName.trim()) {
      toast.error('Vui lòng Preview lại đúng phiếu trước khi Apply')
      return
    }
    setConfirming(false)
    setError(null)
    setApplyLoading(true)
    try {
      const data = await applyLots(previewData.picking.id, previewData.plan_hash)
      setApplyData(data)
      if (data.total_failed > 0) {
        toast.error(
          `Đã tạo ${data.total_created}/${data.total_to_create} lot. Có ${data.total_failed} lỗi.`
        )
      } else {
        toast.success(
          data.total_prepared_done_mos > 0
            ? `Đã chuẩn bị ${data.total_prepared_done_mos} MO Done. Qua Odoo refresh và Validate phiếu.`
            : `Đã tạo ${data.total_created} lot mới, đổi tên ${data.total_renamed || 0} lot nguồn và gán ${data.total_assigned} serial`
        )
      }
    } catch (err) {
      setError(err.message || 'Lỗi khi apply')
      toast.error(err.message || 'Lỗi khi apply')
    } finally {
      setApplyLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handlePreview()
    }
  }

  // Determine which data set to render in the results section.
  const resultData = applyData || previewData
  const isPreview = !!previewData && !applyData

  return (
    <div className="min-h-screen py-8 px-4 relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-teal-100/40 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: '1s' }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-100/24 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: '2s' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Back button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 mb-6"
        >
          <button
            onClick={() => navigate('/')}
            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            aria-label="Quay lại"
          >
            <ArrowLeft size={22} />
          </button>
        </motion.div>

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="inline-block mb-6"
          >
            <div className="p-4 bg-gradient-to-br from-emerald-500/20 via-teal-500/20 to-cyan-500/20 rounded-3xl backdrop-blur-xl border border-white/10 inline-block">
              <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl">
                <span className="text-4xl">🏷️</span>
              </div>
            </div>
          </motion.div>

          <h1
            className="text-5xl md:text-6xl font-bold mb-4"
            style={{
              background: 'linear-gradient(135deg, #10b981, #14b8a6, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Tạo Mã Lot Khi Nhập Kho
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Tự động sinh mã lot/serial cho các sản phẩm tracking="serial" trong
            phiếu nhập kho (Receipts) chưa có lot.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span>Format: PO/MO-CODE-SLUG-NNN (ví dụ: O-MH08966-BED-NERISSA-001)</span>
          </div>
        </motion.header>

        {/* Search / actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="glass-strong rounded-3xl p-6 shadow-2xl mb-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl">
              <Search size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Nhập phiếu Receipt</h2>
              <p className="text-sm text-gray-500">
                Ví dụ: <code className="text-emerald-700 font-mono">O-MID/IN/00282</code> hoặc ID <code className="text-emerald-700 font-mono">16910</code>
              </p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={pickingName}
              onChange={(e) => {
                setPickingName(e.target.value)
                setPreviewData(null)
                setApplyData(null)
                setPreviewInput('')
                setError(null)
              }}
              onKeyPress={handleKeyPress}
              placeholder="Nhập mã phiếu (VD: O-MID/IN/00282 hoặc 16910)"
              className="input flex-1 px-4 py-3 text-lg font-mono"
              disabled={previewLoading || applyLoading}
            />
            <button
              onClick={handlePreview}
              disabled={!pickingName.trim() || previewLoading || applyLoading}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-600 hover:to-indigo-600 transition-all flex items-center justify-center gap-2"
            >
              <Eye size={18} />
              {previewLoading ? 'Đang tải...' : 'Preview'}
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={
                  !pickingName.trim() ||
                  applyLoading ||
                  !previewData ||
                  previewInput !== pickingName.trim() ||
                  !previewData.can_apply
              }
              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center justify-center gap-2"
              title={
                !previewData
                  ? 'Bấm Preview trước'
                  : !previewData.can_apply
                    ? previewData.blocking_issues?.length
                      ? 'Cần xử lý các dòng Detail được cảnh báo trước'
                      : 'Không có lot nào cần tạo'
                    : 'Áp dụng và tạo lot trên Odoo'
              }
            >
              <CheckCircle2 size={18} />
              {applyLoading ? 'Đang tạo...' : 'Apply'}
            </button>
          </div>
        </motion.div>

        {(previewLoading || applyLoading) && <LoadingSpinner />}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-strong rounded-2xl p-6 border-red-200 bg-red-50/50 mb-6"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={24} className="text-red-500 flex-shrink-0" />
              <div>
                <h3 className="text-red-700 font-semibold mb-1">Lỗi</h3>
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Apply confirmation dialog */}
        {confirming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setConfirming(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              className="glass-strong rounded-2xl p-6 max-w-md w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-amber-100 rounded-xl">
                  <AlertTriangle size={22} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">
                    Xác nhận tạo lot trên Production?
                  </h3>
                  <p className="text-sm text-gray-600">
                    Hành động này sẽ tạo <strong>{previewData?.total_to_create || 0}</strong> lot mới,
                    chuẩn hóa tên <strong>{previewData?.total_to_rename || 0}</strong> lot nguồn MO,
                    chuẩn bị <strong>{previewData?.total_done_mos_to_prepare || 0}</strong> MO đã Done và gán{' '}
                    <strong>{previewData?.total_to_assign || 0}</strong> serial vào Detail của
                    <strong> {previewData?.picking?.name}</strong>. Không tự Validate phiếu.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirming(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-medium"
                >
                  Hủy
                </button>
                <button
                  onClick={handleApply}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-lg font-medium"
                >
                  Xác nhận Apply
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Result panel */}
        {resultData && !previewLoading && !applyLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <ResultSummary data={resultData} isPreview={isPreview} />

            {isPreview && resultData.blocking_issues?.length > 0 && (
              <div className="glass-strong rounded-2xl p-5 border border-amber-200 bg-amber-50/50">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={22} className="text-amber-600 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-amber-800">Cần xử lý trước khi Apply</h3>
                    <ul className="mt-2 space-y-1 text-sm text-amber-700">
                      {resultData.blocking_issues.map((issue, index) => (
                        <li key={`${issue.code}-${issue.product_id}-${index}`}>
                          <strong>{issue.product_name}:</strong> {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {resultData.products?.length > 0 ? (
              <div className="space-y-4">
                {resultData.products.map((p) => (
                  <ProductResultCard
                    key={p.product_id}
                    product={p}
                    isPreview={isPreview}
                  />
                ))}
              </div>
            ) : (
              <div className="glass-strong rounded-2xl p-6 text-center text-gray-500">
                <p className="font-medium">
                  Phiếu này không có sản phẩm nào cần tạo lot.
                </p>
                <p className="mt-2 text-sm text-gray-400">
                  Có thể phiếu thuộc loại Subcontracting (cần thao tác thủ công
                  trên Odoo UI vì liên quan đến MO), hoặc tất cả sản phẩm đã có
                  lot / không có sản phẩm nào tracking theo serial.
                </p>
              </div>
            )}

            {resultData.message && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`glass-strong rounded-2xl p-4 border ${
                  isPreview
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-emerald-200 bg-emerald-50/50'
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    isPreview ? 'text-blue-700' : 'text-emerald-700'
                  }`}
                >
                  {isPreview ? '👁️ ' : '✅ '}
                  {resultData.message}
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}

function ResultSummary({ data, isPreview }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-3xl p-6 shadow-2xl"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl">
          <PackageCheck size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900">{data.picking?.name}</h2>
          <p className="text-sm text-gray-500">
            {data.picking?.picking_type || 'Receipts'} · State:{' '}
            <strong>{STATE_LABEL[data.picking?.state] || data.picking?.state}</strong>
            {data.po_code && (
              <>
                {' · Mã PO/MO: '}
                <code className="text-emerald-700 font-mono">{data.po_code}</code>
              </>
            )}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
            isPreview
              ? 'bg-blue-100 text-blue-700'
              : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {isPreview ? 'Preview' : 'Applied'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Hash}
          label="Sản phẩm cần lot"
          value={data.products?.length || 0}
          color="emerald"
        />
        <StatCard
          icon={ListChecks}
          label={isPreview ? 'Serial sẽ gán' : 'Serial đã gán'}
          value={isPreview ? data.total_to_assign || 0 : data.total_assigned || 0}
          color="teal"
        />
        <StatCard
          icon={Tag}
          label={isPreview ? 'Lot mới sẽ tạo' : 'Lot mới đã tạo'}
          value={isPreview ? data.total_to_create || 0 : data.total_created || 0}
          color="amber"
        />
        {isPreview ? (
          <StatCard
            icon={PackageCheck}
            label={data.total_done_mos_to_prepare > 0 ? 'MO Done sẽ chuẩn bị' : 'Lot nguồn đổi tên'}
            value={data.total_done_mos_to_prepare || data.total_to_rename || 0}
            color="emerald"
          />
        ) : (
          <StatCard
            icon={AlertTriangle}
            label="Lỗi"
            value={data.total_failed || 0}
            color="red"
          />
        )}
      </div>
    </motion.div>
  )
}

function StatCard({ icon: Icon, label, value, color = 'emerald' }) {
  const colors = {
    emerald: 'from-emerald-500 to-teal-500',
    teal: 'from-teal-500 to-cyan-500',
    amber: 'from-amber-500 to-orange-500',
    red: 'from-red-500 to-rose-500',
  }
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3">
      <div className={`p-2 bg-gradient-to-br ${colors[color]} rounded-lg`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-lg font-bold text-gray-900">{value}</p>
      </div>
    </div>
  )
}

function ProductResultCard({ product, isPreview }) {
  const hasLots = (product.lots?.length || 0) > 0
  const hasSkipped = (product.skipped?.length || 0) > 0
  const hasFailed = (product.failed?.length || 0) > 0

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-strong rounded-2xl p-5 shadow-xl"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 truncate">
            {product.product_name}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Mã: <strong className="font-mono">{product.product_id}</strong> ·
            Slug: <code className="text-emerald-700 font-mono">{product.slug}</code>
            {product.total_qty != null && (
              <>
                {' · Tổng SL: '}
                <strong>{product.total_qty}</strong>
              </>
            )}
          </p>
        </div>
      </div>

      {hasLots && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            {isPreview ? 'Sẽ gán vào Detail' : 'Đã gán vào Detail'} ({product.lots.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {product.lots.map((lot) => (
              <span
                key={lot.name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg font-mono text-sm text-emerald-800"
              >
                <Tag size={12} />
                {lot.previous_name && (
                  <span className="text-gray-500 line-through" title="Tên lot nguồn trước khi chuẩn hóa">
                    {lot.previous_name}
                  </span>
                )}
                {lot.previous_name && <span className="text-gray-400">→</span>}
                {lot.name}
                {lot.sequence != null && (
                  <span className="text-emerald-500 text-xs">
                    #{String(lot.sequence).padStart(3, '0')}
                  </span>
                )}
                {lot.prepare_done_mo && (
                  <span
                    className="ml-1 text-[10px] text-violet-700 bg-violet-100 rounded px-1"
                    title="Hệ thống sẽ chuẩn bị nhận serial đã sản xuất và tự khôi phục liên kết MO sau Validate"
                  >
                    chuẩn bị MO Done
                  </span>
                )}
                {lot.existing_source_lot && (
                  <span
                    className="ml-1 text-[10px] text-blue-700 bg-blue-100 rounded px-1"
                    title={
                      lot.rename_source_lot || lot.renamed
                        ? 'Lot nguồn MO sẽ/đã được đổi sang tên chuẩn rồi gán vào Detail'
                        : 'Lot đã có trên Manufacturing Order nguồn; hệ thống chỉ gán vào Detail'
                    }
                  >
                    {lot.rename_source_lot || lot.renamed ? 'đổi tên lot nguồn MO' : 'lot nguồn MO'}
                  </span>
                )}
                {!isPreview && lot.assign_method === 'lot_name_pending' && (
                  <span
                    className="ml-1 text-[10px] text-amber-700 bg-amber-100 rounded px-1"
                    title="Mã đã được điền vào Detail; Odoo sẽ tạo stock.lot khi Validate"
                  >
                    tạo khi Validate
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasSkipped && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">
            Bỏ qua — đã tồn tại ({product.skipped.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {product.skipped.map((lot) => (
              <span
                key={lot.name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg font-mono text-sm text-amber-800"
                title={lot.reason}
              >
                <AlertTriangle size={12} />
                {lot.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasFailed && (
        <div>
          <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">
            Lỗi ({product.failed.length})
          </p>
          <div className="space-y-1">
            {product.failed.map((lot, i) => (
              <div
                key={`${lot.name}-${i}`}
                className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
              >
                <span className="font-mono font-semibold">{lot.name}</span>
                <span className="text-red-600 ml-2">— {lot.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasLots && !hasSkipped && !hasFailed && (
        <p className="text-sm text-gray-500 italic">
          Sản phẩm này không cần tạo lot (đã có lot cho mọi move_line, hoặc
          không phải tracking="serial").
        </p>
      )}
    </motion.div>
  )
}
