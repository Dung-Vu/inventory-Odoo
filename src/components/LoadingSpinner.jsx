import { motion } from 'framer-motion'
import { Loader2, Sparkles } from 'lucide-react'

export default function LoadingSpinner() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="mt-8 flex flex-col items-center justify-center py-16"
    >
      <div className="relative">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="relative"
        >
          <div className="p-6 bg-gradient-to-br from-purple-100 to-blue-100 rounded-3xl backdrop-blur-xl border border-purple-200">
            <Loader2 size={48} className="text-purple-600" />
          </div>
        </motion.div>
        <motion.div
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5]
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="absolute inset-0 bg-purple-200/30 rounded-3xl blur-xl"
        />
      </div>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-6 text-gray-600 text-lg flex items-center gap-2"
      >
        <Sparkles size={20} className="text-purple-600" />
        Đang tải dữ liệu...
      </motion.p>
    </motion.div>
  )
}
