import { motion } from 'framer-motion'
import { Search, Sparkles, ScanLine } from 'lucide-react'
import Button from './ui/Button'

export default function SearchSection({ pickingCode, setPickingCode, onSearch, onKeyPress }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="glass-strong rounded-3xl p-8 shadow-2xl relative overflow-hidden"
    >
      {/* Background decoration - Light theme (reduced brightness 20%) */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-50/40 via-blue-50/40 to-cyan-50/40 pointer-events-none" />
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-100/24 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-100/24 rounded-full blur-3xl" />
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl shadow-lg">
            <ScanLine size={24} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Tìm kiếm phiếu nhập kho</h2>
            <p className="text-sm text-gray-600">Nhập mã phiếu hoặc ID để xem chi tiết và in label</p>
          </div>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-purple-400 transition-colors">
              <Search size={22} />
            </div>
            <input
              type="text"
              value={pickingCode}
              onChange={(e) => setPickingCode(e.target.value)}
              onKeyPress={onKeyPress}
              placeholder="Nhập mã phiếu hoặc ID (ví dụ: ORDST/IN/00009 hoặc 12345)"
              className="input pl-12 pr-12 py-4 text-lg"
            />
            {pickingCode && (
              <motion.button
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => setPickingCode('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center w-7 h-7"
                type="button"
              >
                <span className="text-gray-600 text-lg leading-none font-normal">×</span>
              </motion.button>
            )}
          </div>
          <Button
            onClick={onSearch}
            disabled={!pickingCode.trim()}
            leftIcon={<Sparkles size={20} />}
            size="lg"
          >
            Tìm kiếm
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
