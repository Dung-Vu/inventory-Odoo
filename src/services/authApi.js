import axios from 'axios'

const AUTH_URL = `${import.meta.env.VITE_API_URL || '/api'}/auth`

function errorMessage(error, fallback) {
  return error.response?.data?.error || fallback
}

async function post(path, body, fallback) {
  try {
    const response = await axios.post(`${AUTH_URL}${path}`, body, { timeout: 30000, withCredentials: true })
    return response.data
  } catch (error) {
    throw new Error(errorMessage(error, fallback))
  }
}

export const loginWithPassword = (login, password) =>
  post('/login', { login, password }, 'Không đăng nhập được, vui lòng thử lại')

export const verifyTotpCode = (code) =>
  post('/totp', { code }, 'Không xác thực được mã, vui lòng thử lại')

export const logout = () => post('/logout', {}, 'Không đăng xuất được')

export async function fetchCurrentUser() {
  const response = await axios.get(`${AUTH_URL}/me`, { timeout: 15000, withCredentials: true })
  return response.data.user
}

// Only allow same-site relative paths after login (no open redirect).
export function safeNextPath(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) {
    return '/'
  }
  return next
}

export function redirectToLogin() {
  const { pathname, search } = window.location
  if (pathname === '/login') return
  window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`)
}
