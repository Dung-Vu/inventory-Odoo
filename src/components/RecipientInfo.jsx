import { motion } from 'framer-motion'
import { Printer, Download } from 'lucide-react'
import Button from './ui/Button'
import html2pdf from 'html2pdf.js'
import { useRef } from 'react'

export default function RecipientInfo({ deliveryData }) {
  if (!deliveryData) return null

  const { picking, sender, recipient } = deliveryData
  const printRef = useRef(null)

  // Hàm xem trước PDF
  const handlePreview = () => {
    const element = printRef.current
    const opt = {
      margin: 10,
      filename: `Phieu_Nhan_${picking.name.replace(/\//g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }
    
    html2pdf().set(opt).from(element).outputPdf('blob').then((pdfBlob) => {
      const pdfUrl = URL.createObjectURL(pdfBlob)
      window.open(pdfUrl, '_blank')
    })
  }

  // Hàm tải PDF
  const handleDownload = () => {
    const element = printRef.current
    const opt = {
      margin: 10,
      filename: `Phieu_Nhan_${picking.name.replace(/\//g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }
    
    html2pdf().set(opt).from(element).save()
  }

  // Hàm in PDF
  const handlePrint = () => {
    const element = printRef.current
    const opt = {
      margin: 10,
      filename: `Phieu_Nhan_${picking.name.replace(/\//g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }
    
    html2pdf().set(opt).from(element).outputPdf('blob').then((pdfBlob) => {
      const pdfUrl = URL.createObjectURL(pdfBlob)
      const printWindow = window.open(pdfUrl, '_blank')
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print()
        }
      }
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-8 space-y-6"
    >
      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-center">
        <Button
          onClick={handlePreview}
          className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Xem trước PDF
        </Button>
        
        <Button
          onClick={handlePrint}
          className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
        >
          <Printer className="w-5 h-5" />
          In phiếu
        </Button>
        
        <Button
          onClick={handleDownload}
          className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
        >
          <Download className="w-5 h-5" />
          Tải xuống
        </Button>
      </div>

      {/* Preview Card */}
      <div className="glass-strong rounded-2xl p-8 max-w-2xl mx-auto border border-gray-200">
        {/* Phần này sẽ được in PDF */}
        <div 
          ref={printRef}
          className="bg-white rounded-xl p-12 shadow-inner"
          style={{ fontFamily: 'Arial, sans-serif' }}
        >
          {/* Title */}
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-800">
            KIỆN {picking.name}
          </h2>

          {/* Sender Section */}
          <div className="mb-10 space-y-3">
            <h3 className="text-xl font-bold text-gray-800">
              NGƯỜI GỬI: CTY ORDINAIRE Việt Nam
            </h3>
            <p className="text-base text-gray-700 leading-relaxed">
              <span className="font-semibold">ĐỊA CHỈ:</span> 22/12a Vĩnh Phú 33, Vĩnh Phú, Thuận An, Bình Dương
            </p>
            <p className="text-base text-gray-700">
              <span className="font-semibold">SDT:</span> 0862229805 - Mai Hương
            </p>
          </div>

          {/* Recipient Section */}
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-gray-800">
              NGƯỜI NHẬN: {recipient.name || ''}
            </h3>
            <p className="text-base text-gray-700 leading-relaxed">
              <span className="font-semibold">ĐỊA CHỈ:</span> {recipient.address || ''}
            </p>
            {/* NOTE: Không hiển thị SĐT người nhận */}
          </div>
        </div>

        {/* Info Badge - KHÔNG in trong PDF */}
        <div className="mt-4 text-center">
          <span className="inline-block px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
            Phiếu: {picking.name}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
