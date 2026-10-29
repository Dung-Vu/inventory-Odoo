import { useEffect, useState } from 'react'
import { LogOut, UserCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchCurrentUser, logout, redirectToLogin } from '../services/authApi'

export default function UserBadge() {
  const [user, setUser] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    // A 401 here is handled by the global axios interceptor (redirect to /login).
    fetchCurrentUser().then(setUser).catch(() => {})
  }, [])

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
      redirectToLogin()
    } catch (error) {
      toast.error(error.message)
      setLoggingOut(false)
    }
  }

  if (!user) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-gray-200 bg-white/90 px-3 py-2 text-sm text-gray-700 shadow-lg backdrop-blur print:hidden">
      <UserCircle2 className="h-5 w-5 text-purple-500" />
      <span className="max-w-[180px] truncate" title={user.login}>{user.name || user.login}</span>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
        <span>Đăng xuất</span>
      </button>
    </div>
  )
}
