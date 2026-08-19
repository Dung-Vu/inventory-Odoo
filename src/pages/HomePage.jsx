import { useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import SearchSection from '../components/SearchSection'
import PickingInfo from '../components/PickingInfo'
import ProductsList from '../components/ProductsList'
import LoadingSpinner from '../components/LoadingSpinner'
import { usePickingData } from '../hooks/usePickingData'

export default function HomePage() {
  const [pickingCode, setPickingCode] = useState('')
  const [searchCode, setSearchCode] = useState('')
  const { data, isLoading, error } = usePickingData(searchCode)

  const handleSearch = () => {
    if (pickingCode.trim()) {
      setSearchCode(pickingCode.trim())
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="min-h-screen py-8 px-4 relative overflow-hidden">
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-100/40 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: '1s' }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-100/24 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: '2s' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
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
            <div className="p-4 bg-gradient-to-br from-purple-500/20 via-blue-500/20 to-cyan-500/20 rounded-3xl backdrop-blur-xl border border-white/10 inline-block">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl">
                <span className="text-4xl">📦</span>
              </div>
            </div>
          </motion.div>

          <h1 className="text-5xl md:text-6xl font-bold mb-4 gradient-text">
            In Label PDF
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Quản lý và in label cho phiếu nhập kho
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span>Hệ thống sẵn sàng</span>
          </div>

          <div className="mt-8 flex items-center justify-center gap-4 flex-wrap">
            <Link
              to="/recipient-info"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-xl hover:from-purple-600 hover:to-blue-600 transition-all shadow-lg hover:shadow-xl"
            >
              <span className="text-xl">📋</span>
              <span>Phiếu Thông Tin Người Nhận</span>
            </Link>
            <Link
              to="/abc-analysis"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-teal-500 text-white rounded-xl hover:from-green-600 hover:to-teal-600 transition-all shadow-lg hover:shadow-xl"
            >
              <span className="text-xl">📊</span>
              <span>Báo Cáo Doanh Số Nội Thất</span>
            </Link>
            <Link
              to="/abc-analysis/stock-fabrics"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg hover:shadow-xl"
            >
              <span className="text-xl">🧵</span>
              <span>Báo Cáo Doanh Số Vải</span>
            </Link>
            <Link
              to="/qc-search"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl hover:from-orange-600 hover:to-red-600 transition-all shadow-lg hover:shadow-xl"
            >
              <span className="text-xl">🔍</span>
              <span>QC List</span>
            </Link>
            <Link
              to="/generate-lots"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl hover:from-emerald-600 hover:to-teal-600 transition-all shadow-lg hover:shadow-xl"
            >
              <span className="text-xl">🏷️</span>
              <span>Tạo Mã Lot Khi Nhập Kho</span>
            </Link>
          </div>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <SearchSection
            pickingCode={pickingCode}
            setPickingCode={setPickingCode}
            onSearch={handleSearch}
            onKeyPress={handleKeyPress}
          />
        </motion.div>

        {isLoading && <LoadingSpinner />}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 glass-strong rounded-2xl p-6 border-red-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-red-50/50" />
            <div className="relative z-10 flex items-center gap-4">
              <div className="p-3 bg-red-100 rounded-xl">
                <span className="text-2xl">⚠️</span>
              </div>
              <div className="flex-1">
                <h3 className="text-red-600 font-semibold mb-1">Lỗi</h3>
                <p className="text-red-700 text-sm">
                  {error.message || 'Đã xảy ra lỗi khi tải dữ liệu'}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {data?.picking && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <PickingInfo picking={data.picking} />
          </motion.div>
        )}

        {data?.products && data.products.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8"
          >
            <ProductsList products={data.products} picking={data.picking} />
          </motion.div>
        )}
      </div>
    </div>
  )
}
