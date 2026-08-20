import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import dotenv from 'dotenv'

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables strictly from single root .env file
const rootEnvPath = join(__dirname, '..', '.env')
const serverEnvPath = join(__dirname, '.env')
const envPath = existsSync(rootEnvPath) ? rootEnvPath : serverEnvPath

dotenv.config({ path: envPath })

const nodeEnv = process.env.NODE_ENV || 'development'

console.log(`Running in ${nodeEnv} mode`)
console.log(`Loading env from: ${envPath}`)

// Now import other modules after env vars are loaded
import express from 'express'
import cors from 'cors'
import apiRoutes from './routes/api.js'
import qcRoutes from './routes/qc.js'
import generateLotsRoutes, { reconcileDoneMoRepairs } from './routes/generate-lots.js'

// Log loaded env vars (without sensitive data)
console.log('Environment variables loaded:')
console.log('  PORT:', process.env.PORT || 'not set')
console.log('  ODOO_URL:', process.env.ODOO_URL || 'not set')
console.log('  ODOO_DB:', process.env.ODOO_DB || 'not set')
console.log('  ODOO_UID:', process.env.ODOO_UID || 'not set')
console.log('  ODOO_APIKEY:', process.env.ODOO_APIKEY ? '***' : 'NOT SET')

const app = express()
const PORT = parseInt(process.env.PORT || '5005', 10)
const isProduction = process.env.NODE_ENV === 'production'

// Middleware
app.use(cors({
  origin: isProduction ? true : (process.env.FRONTEND_URL || 'http://localhost:3000'),
  credentials: true
}))
app.use(express.json())

// Serve static files in production
if (isProduction) {
  const distPath = join(__dirname, '..', 'dist')
  app.use(express.static(distPath))
  console.log('Serving static files from:', distPath)
}

// Request logging
app.use((req, res, next) => {
  if (!isProduction) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  }
  next()
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// API routes
app.use('/api', apiRoutes)
app.use('/api', qcRoutes)
app.use('/api', generateLotsRoutes)

// Serve index.html for all other routes in production (SPA routing)
if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'dist', 'index.html'))
  })
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
})

// 404 handler for API routes only
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' })
})

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`)
  console.log(`📡 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`)
  console.log(`🔗 Odoo URL: ${process.env.ODOO_URL || 'Not configured'}`)

  const reconcile = () => {
    reconcileDoneMoRepairs().catch((error) => {
      console.error('[LotRepair] reconciliation failed:', error.message)
    })
  }
  setTimeout(reconcile, 5000)
  // Keep the window small when an operator completes a subcontract MO after
  // lot Apply but before validating its receipt.
  const repairTimer = setInterval(reconcile, 10000)
  repairTimer.unref()
})
