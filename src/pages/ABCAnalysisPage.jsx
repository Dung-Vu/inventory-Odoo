import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchABCAnalysis, exportABCAnalysisExcel } from '../services/api'
import LoadingSpinner from '../components/LoadingSpinner'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'

function ABCAnalysisPage({ pageTitle, variantTag }) {
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [productName, setProductName] = useState('')
  const [filterClass, setFilterClass] = useState('all')
  const [quantitySort, setQuantitySort] = useState('default')

  useEffect(() => {
    fetchData()
  }, [variantTag])

  const fetchData = async (overrides = {}) => {
    setLoading(true)
    setError(null)

    const nextStartDate = overrides.startDate ?? startDate
    const nextEndDate = overrides.endDate ?? endDate
    const nextProductName = overrides.productName ?? productName

    try {
      const result = await fetchABCAnalysis({
        startDate: nextStartDate || undefined,
        endDate: nextEndDate || undefined,
        productName: nextProductName || undefined,
        variantTag,
      })

      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFilter = (e) => {
    e.preventDefault()
    fetchData()
  }

  const handleReset = () => {
    setStartDate('')
    setEndDate('')
    setProductName('')
    setFilterClass('all')
    setQuantitySort('default')
    fetchData({
      startDate: '',
      endDate: '',
      productName: '',
    })
  }

  const handleExportExcel = async () => {
    try {
      setExporting(true)
      toast.loading('Đang trích xuất dữ liệu và tạo file Excel...', { id: 'export-excel' })
      await exportABCAnalysisExcel({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        productName: productName || undefined,
        leadtime: 45,
        reviewPeriod: 45,
      })
      toast.success('Xuất file Excel thành công!', { id: 'export-excel' })
    } catch (err) {
      toast.error(err.message || 'Lỗi khi xuất file Excel', { id: 'export-excel' })
    } finally {
      setExporting(false)
    }
  }

  const getFilteredProducts = () => {
    if (!data?.products) return []
    const filteredProducts =
      filterClass === 'all'
        ? [...data.products]
        : data.products.filter((product) => product.abc_class === filterClass)

    if (quantitySort === 'default') {
      return filteredProducts
    }

    return filteredProducts.sort((left, right) => {
      const direction = quantitySort === 'asc' ? 1 : -1
      const leftValue = left.quantity_sold ?? 0
      const rightValue = right.quantity_sold ?? 0

      if (leftValue === rightValue) {
        return left.rank - right.rank
      }

      return leftValue > rightValue ? direction : -direction
    })
  }

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(value)
  }

  const formatPercent = (value) => {
    return `${value?.toFixed(1) || 0}%`
  }

  const formatQuantity = (value) => {
    if (value === null || value === undefined) return '0'
    const num = typeof value === 'number' ? value : Number(value) || 0
    return num.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  }

  const isStockFabricsReport = variantTag === 'Stock fabrics'

  const emptyMessage =
    data?.message || `Không tìm thấy sản phẩm nào với variant tag "${variantTag}".`

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-cyan-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2 rounded-lg bg-white/80 backdrop-blur shadow-sm hover:shadow-md transition-shadow"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                {pageTitle}
              </h1>
              <p className="text-sm text-gray-500">
                {isStockFabricsReport
                  ? 'Theo dõi số mét vải bán trực tiếp và doanh số tương ứng của chính các line vải'
                  : 'Theo dõi và phân tích doanh số sản phẩm & tính toán Reorder'}
              </p>
              <p className="text-xs text-purple-600 font-medium mt-1">Variant tag: {variantTag}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-medium shadow-md shadow-emerald-500/20 hover:shadow-lg transition-all flex items-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              <span>{exporting ? 'Đang xuất file...' : 'Xuất Excel Đồ Gỗ & Ghế (Full Reorder)'}</span>
            </button>
          </div>
        </div>

        {data?.summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/90 backdrop-blur rounded-xl p-4 shadow-sm border border-purple-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Tổng sản phẩm</p>
                <p className="text-2xl font-bold text-purple-600">{data.summary.totalProducts}</p>
              </div>
              <div className="bg-white/90 backdrop-blur rounded-xl p-4 shadow-sm border border-green-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Tổng doanh số</p>
                <p className="text-lg font-bold text-green-600 truncate" title={formatCurrency(data.summary.totalRevenue)}>
                  {formatCurrency(data.summary.totalRevenue)}
                </p>
              </div>
              <div className="bg-white/90 backdrop-blur rounded-xl p-4 shadow-sm border border-red-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Class A</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-red-500">{data.summary.classA_count}</p>
                  <span className="text-xs text-red-400">{formatPercent(data.summary.classA_percent)}</span>
                </div>
              </div>
              <div className="bg-white/90 backdrop-blur rounded-xl p-4 shadow-sm border border-blue-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Doanh số Class A</p>
                <p className="text-lg font-bold text-blue-600 truncate" title={formatCurrency(data.summary.classA_revenue)}>
                  {formatCurrency(data.summary.classA_revenue)}
                </p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <p className="text-xs text-gray-500 mb-2 font-semibold">PHÂN LOẠI ABC:</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">A</span>
                  <span>Top 20% sản phẩm, ~80% doanh số</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">B</span>
                  <span>20-50% sản phẩm, ~15% doanh số</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-gray-400 text-white text-xs font-bold flex items-center justify-center">C</span>
                  <span>50% sản phẩm còn lại, ~5% doanh số</span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 text-xs text-blue-800">
                  <p className="font-semibold mb-1">📊 Độ chính xác dữ liệu:</p>
                  <ul className="space-y-1 text-blue-700">
                    <li>• <strong>SL bán:</strong> Tổng số mét tiêu thụ = <strong>bán trực tiếp</strong> (sale.order.line) + <strong>dùng trong sản xuất</strong> (stock.move từ MO)</li>
                    <li>• <strong>Doanh số:</strong> Doanh thu thuần từ <code className="bg-blue-100 px-1 rounded">price_subtotal</code> chỉ tính đơn bán trực tiếp, chưa VAT</li>
                    <li>• <strong>Lọc theo ngày:</strong> Dùng <code className="bg-blue-100 px-1 rounded">date_order</code> cho đơn bán và <code className="bg-blue-100 px-1 rounded">date</code> cho MO move</li>
                    <li>• <strong>Hiển thị:</strong> Mỗi dòng là một <strong>product variant</strong> được gán tag — hiển thị đủ 65 variant</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="max-w-7xl mx-auto">
        <Card className="mb-6 bg-white/80 backdrop-blur">
          <form onSubmit={handleFilter} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Từ ngày</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Đến ngày</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Tìm sản phẩm</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Tên hoặc mã sản phẩm..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              />
            </div>
            <div className="min-w-[220px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Sắp xếp SL bán</label>
              <select
                value={quantitySort}
                onChange={(e) => setQuantitySort(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              >
                <option value="default">Mặc định: Doanh số giảm dần</option>
                <option value="desc">SL bán giảm dần</option>
                <option value="asc">SL bán tăng dần</option>
              </select>
            </div>
            <Button type="submit" variant="primary">
              Lọc
            </Button>
            <Button type="button" variant="secondary" onClick={handleReset}>
              Reset
            </Button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium shadow-sm hover:shadow transition-all flex items-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              <span>Xuất Excel</span>
            </button>
          </form>

          <div className="flex gap-2 mt-4 border-t pt-4">
            {['all', 'A', 'B', 'C'].map((cls) => (
              <button
                key={cls}
                onClick={() => setFilterClass(cls)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  filterClass === cls
                    ? cls === 'A'
                      ? 'bg-red-100 text-red-700 border border-red-300'
                      : cls === 'B'
                        ? 'bg-amber-100 text-amber-700 border border-amber-300'
                        : cls === 'C'
                          ? 'bg-gray-100 text-gray-700 border border-gray-300'
                          : 'bg-purple-100 text-purple-700 border border-purple-300'
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {cls === 'all' ? 'Tất cả' : `Class ${cls}`}
                {cls !== 'all' && data?.summary && (
                  <span className="ml-1 text-xs">
                    ({cls === 'A' ? data.summary.classA_count : cls === 'B' ? data.summary.classB_count : data.summary.classC_count})
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            Lỗi: {error}
          </div>
        )}

        <Card className="bg-white/90 backdrop-blur overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-purple-100 to-blue-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Class</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sản Phẩm</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Company</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    {isStockFabricsReport ? 'SL Tiêu Thụ (m)' : 'SL Bán'}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Doanh Số</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">%</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Tích Lũy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getFilteredProducts().map((product, index) => (
                  <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500">{index + 1}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white ${
                          product.abc_class === 'A'
                            ? 'bg-gradient-to-br from-red-500 to-rose-600'
                            : product.abc_class === 'B'
                              ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                              : 'bg-gradient-to-br from-gray-500 to-slate-600'
                        }`}
                      >
                        {product.abc_class}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800">{product.product_name || product.name}</p>
                          {product.variant ? (
                            <p className="text-xs text-purple-600 font-medium">{product.variant}</p>
                          ) : product.default_code && product.default_code !== 'N/A' ? (
                            <p className="text-xs text-gray-400 font-mono">{product.default_code}</p>
                          ) : null}
                        </div>
                        {product.odoo_url && (
                          <a
                            href={product.odoo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Mở trong Odoo"
                            className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 align-top">
                      {product.company || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {isStockFabricsReport ? (
                        <div>
                          <span className="font-medium">{formatQuantity(product.quantity_sold)} m</span>
                          {(product.quantity_in_mo > 0 || product.quantity_sold > product.quantity_in_mo) && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {product.quantity_sold - (product.quantity_in_mo || 0) > 0 && (
                                <span className="text-green-600">↑{formatQuantity(product.quantity_sold - (product.quantity_in_mo || 0))} bán</span>
                              )}
                              {product.quantity_in_mo > 0 && product.quantity_sold - (product.quantity_in_mo || 0) > 0 && ' + '}
                              {product.quantity_in_mo > 0 && (
                                <span className="text-blue-500">{formatQuantity(product.quantity_in_mo)} SX</span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        formatQuantity(product.quantity_sold)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-green-600">
                      {formatCurrency(product.total_sales)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {formatPercent(product.sales_percent)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm text-gray-600">{formatPercent(product.cumulative_percent)}</span>
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              product.abc_class === 'A'
                                ? 'bg-red-500'
                                : product.abc_class === 'B'
                                  ? 'bg-amber-500'
                                  : 'bg-gray-400'
                            }`}
                            style={{ width: `${Math.min(product.cumulative_percent, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {getFilteredProducts().length === 0 && !loading && (
            <div className="text-center py-12 text-gray-500">
              {emptyMessage}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default ABCAnalysisPage
