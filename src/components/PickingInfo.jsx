import { motion } from 'framer-motion'
import { Package, Calendar, MapPin, CheckCircle, FileText } from 'lucide-react'
import Badge from './ui/Badge'
import Card from './ui/Card'

export default function PickingInfo({ picking }) {
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStateBadge = (state) => {
    const badges = {
      done: { variant: 'success', label: 'Hoàn thành' },
      draft: { variant: 'info', label: 'Nháp' },
      assigned: { variant: 'info', label: 'Đã gán' },
      waiting: { variant: 'info', label: 'Chờ xử lý' },
    }
    return badges[state] || { variant: 'info', label: state || 'N/A' }
  }

  const infoItems = [
    {
      icon: FileText,
      label: 'Mã phiếu',
      value: picking.name || 'N/A',
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      icon: Calendar,
      label: 'Ngày nhận',
      value: formatDate(picking.date_done || picking.scheduled_date),
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      icon: CheckCircle,
      label: 'Trạng thái',
      value: picking.state || 'N/A',
      badge: true,
      gradient: 'from-green-500 to-emerald-500',
    },
    {
      icon: MapPin,
      label: 'Nguồn',
      value: picking.origin || 'N/A',
      gradient: 'from-orange-500 to-rose-500',
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mt-8"
    >
      <Card className="relative overflow-hidden">
        {/* Background decoration - Light theme (reduced brightness 20%) */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-100/24 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-100/24 rounded-full blur-3xl" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 rounded-2xl shadow-glow">
              <Package size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold gradient-text">Thông tin phiếu</h2>
              <p className="text-gray-600 text-sm mt-1">Chi tiết về phiếu nhập kho</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {infoItems.map((item, index) => {
              const Icon = item.icon
              const stateBadge = item.badge ? getStateBadge(picking.state) : null
              
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.1, duration: 0.3 }}
                  className="glass-subtle rounded-2xl p-5 card-hover group"
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-3 bg-gradient-to-br ${item.gradient} rounded-xl shadow-lg group-hover:scale-110 transition-transform`}>
                      <Icon size={22} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-500 text-xs font-medium mb-2 uppercase tracking-wide">
                        {item.label}
                      </p>
                      {item.badge && stateBadge ? (
                        <Badge variant={stateBadge.variant}>
                          {stateBadge.label}
                        </Badge>
                      ) : (
                        <p className="text-gray-900 text-lg font-semibold truncate">
                          {item.value}
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
