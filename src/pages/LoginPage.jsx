import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { loginWithPassword, safeNextPath, verifyTotpCode } from '../services/authApi'

export default function LoginPage() {
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState('password')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const run = async (action) => {
    setError('')
    setLoading(true)
    try {
      await action()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePassword = (e) => {
    e.preventDefault()
    run(async () => {
      await loginWithPassword(login.trim(), password)
      setPassword('')
      setStep('totp')
    })
  }

  const handleTotp = (e) => {
    e.preventDefault()
    run(async () => {
      try {
        await verifyTotpCode(code)
      } catch (err) {
        setCode('')
        if (/hết hạn|đăng nhập lại/i.test(err.message)) setStep('password')
        throw err
      }
      window.location.assign(safeNextPath(searchParams.get('next')))
    })
  }

  const inputClass =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-800 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-200'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-100/40 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-100/40 rounded-full blur-3xl animate-pulse-slow" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-3xl border border-gray-100 bg-white/90 p-8 shadow-xl backdrop-blur"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 inline-flex rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 p-3 text-white">
            {step === 'password' ? <KeyRound className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
          </div>
          <h1 className="text-2xl font-bold gradient-text">In Label PDF</h1>
          <p className="mt-2 text-sm text-gray-500">
            {step === 'password'
              ? 'Đăng nhập bằng tài khoản Odoo của bạn'
              : 'Nhập mã 6 số trong ứng dụng xác thực (Google Authenticator…) đã liên kết với Odoo'}
          </p>
        </div>

        {step === 'password' ? (
          <form onSubmit={handlePassword} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="login">Email Odoo</label>
              <input
                id="login"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="password">Mật khẩu</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 py-3 font-medium text-white shadow-lg transition hover:from-purple-600 hover:to-blue-600 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Tiếp tục
            </button>
          </form>
        ) : (
          <form onSubmit={handleTotp} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={6}
              pattern="\d{6}"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 py-3 font-medium text-white shadow-lg transition hover:from-purple-600 hover:to-blue-600 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác thực
            </button>
            <button
              type="button"
              onClick={() => { setStep('password'); setCode(''); setError('') }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Đăng nhập bằng tài khoản khác
            </button>
            <p className="text-center text-xs text-gray-400">Phiên đăng nhập được giữ 3 tháng trên trình duyệt này.</p>
          </form>
        )}
      </motion.div>
    </div>
  )
}
