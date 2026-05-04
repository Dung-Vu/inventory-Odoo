import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0', // Cho phép truy cập từ mạng nội bộ
      port: 3001,
      open: true,
      strictPort: false, // Cho phép tự động chọn port khác nếu 3001 bị chiếm
      proxy: {
        // Proxy đến backend Express server 
        // Dev: port 5005 (từ .env.development)
        // Docker: port 5003 (từ .env production)
        '/api': {
          target: env.VITE_BACKEND_URL || 'http://localhost:5005',
          changeOrigin: true,
          secure: false,
        }
      }
    }
  }
})
