import { timingSafeEqual } from 'crypto'

// Optional HTTP Basic Auth for the sales / consumption reports.
// Enabled only when REPORT_AUTH_USER and REPORT_AUTH_PASSWORD are both set, so
// deployments without these env vars keep the current open behaviour.

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

export function reportBasicAuth(env = process.env) {
  return (req, res, next) => {
    const user = env.REPORT_AUTH_USER
    const password = env.REPORT_AUTH_PASSWORD
    if (!user || !password) return next()

    const header = req.headers.authorization || ''
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const sep = decoded.indexOf(':')
      if (sep >= 0 && safeEqual(decoded.slice(0, sep), user) && safeEqual(decoded.slice(sep + 1), password)) {
        return next()
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="Bao cao doanh so", charset="UTF-8"')
    return res.status(401).json({ error: 'Cần đăng nhập để xem báo cáo' })
  }
}
