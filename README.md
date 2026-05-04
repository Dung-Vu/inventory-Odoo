# In Label PDF - Quản lý Phiếu Nhập Kho

Web application hiện đại được xây dựng với React + Vite để quản lý và in label PDF cho phiếu nhập kho từ hệ thống Odoo.

## ✨ Tính năng

- 🎨 **Giao diện nghệ thuật**: Thiết kế hiện đại với gradient, glassmorphism và animations mượt mà
- 🔍 **Tìm kiếm thông minh**: Tìm kiếm phiếu nhập kho theo mã phiếu
- 📊 **Hiển thị chi tiết**: Thông tin phiếu và danh sách sản phẩm đầy đủ
- 🖨️ **In label PDF**: Layout 4x12 (4 cột x 12 hàng = 48 labels/trang)
- 📋 **Thông tin label**: Mỗi label chứa tên sản phẩm, mã sản phẩm, số lô, ngày nhận

## 🚀 Công nghệ sử dụng

- **React 18** - UI Framework
- **Vite** - Build tool nhanh chóng
- **Tailwind CSS** - Utility-first CSS framework
- **Framer Motion** - Animations mượt mà
- **React Query** - Data fetching và caching
- **jsPDF** - Tạo file PDF
- **Lucide React** - Icons đẹp
- **React Hot Toast** - Notifications

## 📦 Cài đặt

```bash
# Cài đặt dependencies
npm install

# Cấu hình Backend (bắt buộc)
# Tạo file .env trong thư mục server/
cp server/.env.example server/.env

# Chỉnh sửa server/.env với thông tin Odoo của bạn:
# ODOO_URL=https://your-odoo-instance.com/jsonrpc
# ODOO_DB=your_database_name
# ODOO_UID=your_user_id
# ODOO_APIKEY=your_api_key

# Chạy cả Backend và Frontend cùng lúc
npm run dev:full

# Hoặc chạy riêng lẻ:
# Terminal 1: Backend server
npm run dev:server

# Terminal 2: Frontend (trong terminal khác)
npm run dev

# Build cho production
npm run build

# Chạy production server
npm start
```

## 🎯 Cách sử dụng

### Development (Local)

1. Chạy `npm install` để cài đặt dependencies
2. Chạy `npm run dev` để khởi động development server
3. Mở trình duyệt tại `http://localhost:3000`
4. Nhập mã phiếu (ví dụ: `PICKING_CODE`)
5. Nhấn nút "Tìm kiếm" hoặc nhấn Enter
6. Xem chi tiết sản phẩm với giao diện đẹp mắt
7. Nhấn "In Label" để tạo file PDF

### Cho phép truy cập từ mạng nội bộ

1. Chạy `npm run dev:network` để khởi động server với network access
2. Server sẽ hiển thị địa chỉ IP local của bạn (ví dụ: `http://192.168.1.100:3000`)
3. Người khác trong cùng mạng có thể truy cập bằng địa chỉ IP này
4. **Lưu ý**: Đảm bảo firewall cho phép kết nối đến port 3000

### Deploy Production

1. Chạy `npm run build` để build production
2. Files sẽ được tạo trong thư mục `dist/`
3. Deploy thư mục `dist/` lên web server (Nginx, Apache, Vercel, Netlify, etc.)
4. Cấu hình server để serve static files từ `dist/`

## ⚙️ Cấu hình Backend

Cấu hình Odoo API được lưu trong file `server/.env`. Tạo file từ template:

```bash
cp server/.env.example server/.env
```

Sau đó chỉnh sửa file `server/.env` với thông tin Odoo của bạn:

```env
ODOO_URL=https://your-odoo-instance.com/jsonrpc
ODOO_DB=your_database_name
ODOO_UID=your_user_id
ODOO_APIKEY=your_api_key
PORT=5000
FRONTEND_URL=http://localhost:3000
```

**Lưu ý**: 
- File `server/.env` đã được thêm vào `.gitignore` để bảo mật thông tin
- Không commit file `.env` lên repository
- Backend chạy trên port 5003 (có thể thay đổi trong `server/.env`)
- Frontend proxy requests đến backend qua `/api`

## 📁 Cấu trúc project

```
in-label-pdf/
├── src/
│   ├── components/          # React components
│   │   ├── SearchSection.jsx
│   │   ├── PickingInfo.jsx
│   │   ├── ProductsList.jsx
│   │   ├── ProductCard.jsx
│   │   └── LoadingSpinner.jsx
│   ├── hooks/               # Custom hooks
│   │   └── usePickingData.js
│   ├── services/            # API services
│   │   └── api.js
│   ├── App.jsx              # Main app component
│   ├── main.jsx             # Entry point
│   └── index.css            # Global styles
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README.md
```

## 🎨 Tính năng UI/UX

- **Glassmorphism**: Hiệu ứng kính mờ hiện đại
- **Gradient backgrounds**: Nền gradient đẹp mắt
- **Smooth animations**: Animations mượt mà với Framer Motion
- **Responsive design**: Tối ưu cho mọi kích thước màn hình
- **Dark theme**: Giao diện tối hiện đại
- **Loading states**: Spinner loading đẹp
- **Error handling**: Hiển thị lỗi rõ ràng
- **Toast notifications**: Thông báo đẹp mắt

## 📝 Ghi chú

- Label được tạo với kích thước 48mm x 20mm
- Layout 4x12 trên khổ giấy A4 (48 labels/trang)
- Số lượng label = số lượng sản phẩm trong phiếu
- Hỗ trợ nhiều lô (lots) cho mỗi sản phẩm

## 🔧 Yêu cầu

- Node.js 18+ 
- npm hoặc yarn
- Trình duyệt web hiện đại (Chrome, Firefox, Edge, Safari)
- Kết nối internet để gọi API Odoo
