import { motion } from 'framer-motion'
import { Package, Tag, Calendar, Hash, Printer, Layers, Calculator } from 'lucide-react'
import { printLabels } from './ProductsList'
import Card from './ui/Card'
import Badge from './ui/Badge'
import Button from './ui/Button'

export default function ProductCard({ product, picking, multiplier = '', onMultiplierChange }) {
  const handlePrint = () => {
    const multiplierValue = multiplier ? parseFloat(multiplier) : 1
    printLabels(product, picking, multiplierValue)
  }
  
  const getTotalLabels = () => {
    const multiplierValue = multiplier ? parseFloat(multiplier) : 1
    return Math.floor(product.quantity * multiplierValue)
  }
  
  const handleMultiplierInputChange = (e) => {
    const value = e.target.value
    if (value === '' || (parseFloat(value) > 0)) {
      onMultiplierChange?.(value)
    }
  }

  const dateStr =
    picking.date_done || picking.scheduled_date
      ? new Date(picking.date_done || picking.scheduled_date).toLocaleDateString('vi-VN')
      : 'N/A'

  return (
    <Card hover interactive={false} className="relative overflow-hidden group h-full">
      {/* Background gradient - Light theme (reduced brightness 20%) */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/40 via-blue-50/40 to-purple-50/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-100/24 rounded-full blur-2xl" />
      
      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="p-4 bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 rounded-2xl shadow-glow group-hover:scale-110 transition-transform">
            <Package size={28} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-purple-600 transition-colors">
              {product.product_name}
            </h3>
            <Badge variant="primary" className="mt-2">
              {product.quantity} {product.uom}
            </Badge>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 gap-3 mb-6">
          <div className="flex items-center gap-3 p-3 glass-subtle rounded-xl">
            <Hash size={18} className="text-cyan-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 mb-0.5">Mã sản phẩm</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{product.product_id}</p>
            </div>
          </div>
          
          {product.variant && (
            <div className="flex items-center gap-3 p-3 glass-subtle rounded-xl">
              <Tag size={18} className="text-yellow-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-0.5">Variant</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{product.variant}</p>
              </div>
            </div>
          )}
          
          <div className="flex items-center gap-3 p-3 glass-subtle rounded-xl">
            <Calendar size={18} className="text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 mb-0.5">Ngày nhận</p>
              <p className="text-sm font-semibold text-gray-900">{dateStr}</p>
            </div>
          </div>
        </div>

        {/* Multiplier Input */}
        <div className="mb-6 p-4 glass-subtle rounded-xl border border-gray-200">
          <div className="flex items-center gap-2 mb-3">
            <Calculator size={18} className="text-purple-600" />
            <h4 className="text-sm font-semibold text-gray-700">
              Số lượng nhân (tùy chọn)
            </h4>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <input
                type="number"
                min="1"
                step="1"
                value={multiplier}
                onChange={handleMultiplierInputChange}
                placeholder="Mặc định: 1 (theo quantity)"
                className="input w-full"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                {multiplier 
                  ? `Sẽ in: ${product.quantity} × ${multiplier} = ${getTotalLabels()} labels`
                  : `Mặc định in: ${product.quantity} labels (theo quantity)`
                }
              </p>
            </div>
            {multiplier && (
              <motion.button
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => onMultiplierChange?.('')}
                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors flex-shrink-0"
                type="button"
              >
                <span className="text-gray-600 text-sm">×</span>
              </motion.button>
            )}
          </div>
        </div>

        {/* Lots */}
        {product.lots && product.lots.length > 0 && (
          <div className="mb-6 p-4 glass-subtle rounded-xl border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <Layers size={18} className="text-purple-600" />
              <h4 className="text-sm font-semibold text-gray-700">
                Danh sách lô ({product.lots.length})
              </h4>
            </div>
            <div className="space-y-2">
              {product.lots.map((lot, index) => (
                <motion.div
                  key={lot.lot_id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <span className="text-gray-900 text-sm font-medium">{lot.lot_name}</span>
                  <Badge variant="info" className="text-xs">
                    SL: {lot.qty_done}
                  </Badge>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Print Button */}
        <div className="mt-auto pt-2">
          <Button
            onClick={handlePrint}
            className="w-full"
            leftIcon={<Printer size={20} />}
          >
            In Label ({getTotalLabels()} labels)
          </Button>
        </div>
      </div>
    </Card>
  )
}
