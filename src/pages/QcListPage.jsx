import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Search, Filter, Trash2, Eye, ClipboardList, CheckCircle, AlertTriangle, XCircle, Clock, Loader, Plus, Home } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchQcList, deleteQcBatch, fetchQcStats } from '../services/qcApi'

const STATUS_CONFIG = {
  passed: { label: 'Đạt', color: 'bg-green-100 text-green-700 border-green-300', icon: CheckCircle },
  pending: { label: 'Chờ QC', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: Clock },
  failed: { label: 'Lỗi', color: 'bg-red-100 text-red-700 border-red-300', icon: XCircle },
  warning: { label: 'Cảnh báo', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: AlertTriangle },
  partial: { label: 'Một phần', color: 'bg-blue-100 text-blue-700 border-blue-300', icon: Loader },
}

export default function QcListPage() {
  const navigate = useNavigate()
  const [batches, setBatches] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [total, setTotal] = useState(0)

  const loadData = async () => {
    setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        fetchQcList({ search, status: statusFilter }),
        fetchQcStats(),
      ])
      setBatches(listRes.batches)
      setTotal(listRes.total)
      setStats(statsRes)
    } catch (err) {
      toast.error('Lỗi tải danh sách QC')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [search, statusFilter])

  const handleDelete = async (id, name) => {
    if (!confirm(`Xóa QC batch "${name}"?`)) return
    try {
      await deleteQcBatch(id)
      toast.success('Đã xóa')
      loadData()
    } catch (err) {
      toast.error('Lỗi khi xóa')
    }
  }

  return (
    <div className="min-h-screen py-8 px-4 relative overflow-hidden">
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-100/40 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Back + Nav */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-white/60 rounded-xl transition-colors">
            <Home size={22} />
          </button>
          <button onClick={() => navigate('/qc-search')} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl flex items-center gap-2 hover:from-orange-600 hover:to-red-600 transition-all text-sm font-medium">
            <Plus size={16} />
            Thêm phiếu mới
          </button>
        </motion.div>

        {/* Header */}
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <div className="inline-block mb-4">
            <div className="p-4 bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 rounded-3xl backdrop-blur-xl border border-white/10 inline-block">
              <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl">
                <span className="text-4xl">📋</span>
              </div>
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-3" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            QC List
          </h1>
          <p className="text-lg text-gray-600">Danh sách phiếu cần kiểm tra chất lượng</p>
        </motion.header>

        {/* Stats */}
        {stats && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="glass-strong rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-gray-900">{stats.total_batches}</p>
              <p className="text-sm text-gray-500">Tổng batches</p>
            </div>
            <div className="glass-strong rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-green-600">{stats.passed_batches}</p>
              <p className="text-sm text-gray-500">Đạt</p>
            </div>
            <div className="glass-strong rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600">{stats.pending_batches}</p>
              <p className="text-sm text-gray-500">Chờ QC</p>
            </div>
            <div className="glass-strong rounded-2xl p-4 text-center">
              <p className="text-3xl font-bold text-red-600">{stats.failed_batches}</p>
              <p className="text-sm text-gray-500">Có lỗi</p>
            </div>
          </motion.div>
        )}

        {/* Filters */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-3xl p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo mã phiếu, đối tác, origin..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="relative">
              <Filter size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-10 pr-8 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent appearance-none bg-white"
              >
                <option value="">Tất cả trạng thái</option>
                {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>

        {/* Batch List */}
        {loading ? (
          <div className="text-center py-12">
            <Loader size={40} className="mx-auto text-gray-400 animate-spin" />
            <p className="mt-3 text-gray-500">Đang tải...</p>
          </div>
        ) : batches.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-strong rounded-2xl p-12 text-center">
            <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-lg text-gray-500">Chưa có QC batch nào</p>
            <button
              onClick={() => navigate('/qc-search')}
              className="mt-4 px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:from-indigo-600 hover:to-purple-600 transition-all"
            >
              Tìm phiếu để QC
            </button>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch, i) => {
              const status = STATUS_CONFIG[batch.overall_status] || STATUS_CONFIG.pending
              const StatusIcon = status.icon
              return (
                <motion.div
                  key={batch.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-strong rounded-2xl p-5 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/qc-detail/${batch.id}`)}>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-gray-900 truncate">{batch.picking_name}</h3>
                        <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${status.color} flex items-center gap-1`}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                        <span>Đối tác: <strong className="text-gray-700">{batch.partner}</strong></span>
                        <span>Sản phẩm: <strong className="text-gray-700">{batch.selected_count}</strong></span>
                        <span>Ngày lưu: <strong className="text-gray-700">{new Date(batch.created_at).toLocaleString('vi-VN')}</strong></span>
                      </div>
                      {/* Progress */}
                      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                        <span className="text-green-600">✅ {batch.passed_count || 0}</span>
                        <span className="text-yellow-600">⏳ {batch.pending_count || 0}</span>
                        <span className="text-red-600">❌ {batch.failed_count || 0}</span>
                        {batch.warning_count > 0 && <span className="text-orange-600">⚠️ {batch.warning_count}</span>}
                        <span className="ml-auto">{batch.total_items} tổng</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => navigate(`/qc-detail/${batch.id}`)}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Xem chi tiết"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(batch.id, batch.picking_name)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
