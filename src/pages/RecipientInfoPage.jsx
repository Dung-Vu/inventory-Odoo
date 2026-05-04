import { useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import SearchSection from '../components/SearchSection'
import RecipientInfo from '../components/RecipientInfo'
import LoadingSpinner from '../components/LoadingSpinner'
import { useQuery } from '@tanstack/react-query'
import { fetchDeliveryInfo } from '../services/api'

export default function RecipientInfoPage() {
  const [pickingCode, setPickingCode] = useState('')
  const [searchCode, setSearchCode] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['deliveryInfo', searchCode],
    queryFn: () => fetchDeliveryInfo(searchCode),
    enabled: !!searchCode,
    retry: 1,
  })

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
      {/* Animated background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-100/40 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-100/24 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '2s' }} />
      </div>
      
      <div className="max-w-7xl mx-auto relative z-10">
        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Quay lại trang chủ</span>
          </Link>
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
            <div className="p-4 bg-gradient-to-br from-purple-500/20 via-blue-500/20 to-cyan-500/20 rounded-3xl backdrop-blur-xl border border-white/10 inline-block">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl">
                <span className="text-4xl">📋</span>
              </div>
            </div>
          </motion.div>
          
          <h1 className="text-5xl md:text-6xl font-bold mb-4 gradient-text">
            Phiếu Thông Tin Người Nhận
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Tạo phiếu thông tin người nhận từ đơn giao hàng Odoo
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span>Hệ thống sẵn sàng</span>
          </div>
        </motion.header>

        {/* Search Section */}
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

        {/* Loading */}
        {isLoading && <LoadingSpinner />}

        {/* Error */}
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

        {/* Recipient Info */}
        {data && <RecipientInfo deliveryData={data} />}
      </div>
    </div>
  )
}
