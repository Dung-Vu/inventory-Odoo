# Deployment Guide - In Label PDF

## 🚀 Docker Deployment

### Bước 1: Build Docker Image

```bash
# Build image
docker-compose build

# Hoặc build trực tiếp
docker build -t in-label-pdf .
```

### Bước 2: Chạy Container

```bash
# Sử dụng docker-compose (recommended)
docker-compose up -d

# Hoặc chạy trực tiếp
docker run -d \
  --name in-label-pdf \
  -p 5003:5003 \
  --env-file ./server/.env \
  in-label-pdf
```

### Bước 3: Kiểm tra container

```bash
# Xem logs
docker-compose logs -f

# Kiểm tra status
docker-compose ps

# Stop container
docker-compose down
```

## 🌐 Cloudflare Tunnel Setup

### Bước 1: Cài đặt Cloudflared

```bash
# Windows (PowerShell as Administrator)
winget install --id Cloudflare.cloudflared

# Hoặc download từ: https://github.com/cloudflare/cloudflared/releases
```

### Bước 2: Đăng nhập Cloudflare

```bash
cloudflared tunnel login
```

### Bước 3: Tạo Tunnel

```bash
# Tạo tunnel mới
cloudflared tunnel create in-label-pdf

# Lấy tunnel ID (sẽ hiển thị sau khi tạo)
cloudflared tunnel list
```

### Bước 4: Cấu hình DNS

Tạo file `config.yml` trong `C:\Users\<Your-User>\.cloudflared\config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\<Your-User>\.cloudflared\<TUNNEL_ID>.json

ingress:
  # In Label PDF
  - hostname: in-label.yourdomain.com
    service: http://localhost:5003
  
  # Các project khác
  # - hostname: other-app.yourdomain.com
  #   service: http://localhost:3000
  
  # Catch-all rule (required)
  - service: http_status:404
```

### Bước 5: Cấu hình DNS trên Cloudflare Dashboard

1. Vào Cloudflare Dashboard
2. Chọn domain của bạn
3. Vào **DNS** → **Records**
4. Thêm CNAME record:
   - Name: `in-label` (hoặc subdomain bạn muốn)
   - Target: `<TUNNEL_ID>.cfargotunnel.com`
   - Proxy status: Proxied (orange cloud)

### Bước 6: Chạy Tunnel

```bash
# Chạy tunnel
cloudflared tunnel run in-label-pdf

# Hoặc chạy as Windows Service
cloudflared service install
```

### Bước 7: Cập nhật FRONTEND_URL

Sửa file `server/.env`:

```env
FRONTEND_URL=https://in-label.yourdomain.com
```

Restart container:

```bash
docker-compose restart
```

## 🔄 Update Workflow

### Cập nhật code và deploy lại:

```bash
# Pull latest code
git pull

# Rebuild và restart
docker-compose down
docker-compose build
docker-compose up -d
```

## 📊 Monitoring

### Health Check

```bash
# Check app health
curl http://localhost:5003/health

# Check từ domain
curl https://in-label.yourdomain.com/health
```

### Container Logs

```bash
# Xem logs real-time
docker-compose logs -f

# Xem logs của 1 service
docker-compose logs -f in-label-pdf
```

## 🔐 Security Notes

1. **Không commit file .env** vào git
2. **Sử dụng secrets** cho production
3. **Enable Cloudflare WAF** và rate limiting
4. **Backup .env file** thường xuyên

## 🐛 Troubleshooting

### Container không start:

```bash
# Xem logs
docker-compose logs

# Kiểm tra .env file
cat server/.env
```

### Tunnel không connect:

```bash
# Kiểm tra tunnel status
cloudflared tunnel list

# Test connection
cloudflared tunnel run <tunnel-name>
```

### Port conflict:

```bash
# Thay đổi port trong docker-compose.yml
ports:
  - "5004:5003"  # External:Internal
```

## 📞 Support

Nếu gặp vấn đề, kiểm tra:
- Logs: `docker-compose logs -f`
- Health endpoint: `/health`
- Cloudflare Tunnel status
