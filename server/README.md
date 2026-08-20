# Backend Server

Express.js server để xử lý API calls đến Odoo.

## Cấu hình

Tạo file `.env` ở thư mục gốc (root) của dự án với nội dung:

```env
# Odoo API Configuration
ODOO_URL=https://your-odoo-instance.odoo.com/jsonrpc
ODOO_DB=your_database_name
ODOO_UID=0
ODOO_APIKEY=replace_with_your_odoo_api_key

# Server Configuration
PORT=5003
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

## Chạy server

```bash
# Development
npm run dev:server

# Production
npm start
```

## API Endpoints

### GET /api/picking/:code
Lấy thông tin phiếu nhập kho và sản phẩm

**Parameters:**
- `code` (string): Mã phiếu nhập kho (ví dụ: PICKING_CODE)

**Response:**
```json
{
  "picking": {
    "id": 123,
    "name": "PICKING_CODE",
    "state": "done",
    "partner": "Supplier Name",
    "scheduled_date": "2024-01-01",
    "date_done": "2024-01-01",
    "origin": "PO001",
    "picking_type": "Receipts"
  },
  "products": [
    {
      "product_id": "PROD001",
      "product_name": "Product Name",
      "quantity": 10,
      "uom": "Units",
      "variant": "Màu: Red | KT: 100x50",
      "lots": [
        {
          "lot_id": 1,
          "lot_name": "LOT001",
          "qty_done": 10
        }
      ]
    }
  ]
}
```

### GET /health
Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```
