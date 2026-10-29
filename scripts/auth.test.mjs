import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import Database from 'better-sqlite3'
import { createOdooWebLogin, OdooLoginError } from '../server/auth/odoo-web-login.js'
import { createSessionStore } from '../server/auth/sessions.js'
import { createAuth, isPublicRequest, parseCookies } from '../server/auth/index.js'

const DAY = 24 * 60 * 60 * 1000

function fakeResponse({ status = 200, json, text = '', cookies = [], location }) {
  const headers = new Headers()
  if (location) headers.set('location', location)
  headers.getSetCookie = () => cookies
  return {
    status,
    headers,
    json: async () => (json === undefined ? JSON.parse(text) : json),
    text: async () => text,
  }
}

// Scripted fake Odoo: each handler receives (url, init) and returns a fake response.
function fakeOdoo(routes) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname
    calls.push({ path, method: init.method || 'GET', cookie: init.headers?.Cookie, body: init.body })
    const handler = routes[`${init.method || 'GET'} ${path}`]
    if (!handler) throw new Error(`unexpected ${init.method || 'GET'} ${path}`)
    return handler(init)
  }
  return { fetchImpl, calls }
}

const TOTP_FORM = '<form><input type="hidden" name="csrf_token" value="csrf123"/></form>'

test('2FA account: password then TOTP code returns uid and logs the Odoo session out', async () => {
  const odoo = fakeOdoo({
    'POST /web/session/authenticate': () =>
      fakeResponse({ json: { result: { uid: null } }, cookies: ['session_id=pre; Path=/; HttpOnly'] }),
    'GET /web/login/totp': () => fakeResponse({ text: TOTP_FORM }),
    'POST /web/login/totp': (init) => {
      assert.match(init.body, /csrf_token=csrf123/)
      assert.match(init.body, /totp_token=123456/)
      return fakeResponse({ status: 303, location: '/odoo', cookies: ['session_id=full; Path=/'] })
    },
    'POST /web/session/get_session_info': () => fakeResponse({ json: { result: { uid: 7 } } }),
    'GET /web/session/logout': () => fakeResponse({ status: 303, location: '/web/login' }),
  })
  const web = createOdooWebLogin({ baseUrl: 'https://odoo.test', db: 'db', fetchImpl: odoo.fetchImpl })

  const started = await web.startLogin('a@b.c', 'pw')
  assert.equal(started.mfaRequired, true)
  assert.equal(await web.verifyTotp(started.jar, '123456'), 7)

  assert.equal(odoo.calls[1].cookie, 'session_id=pre')
  assert.equal(odoo.calls.at(-1).path, '/web/session/logout')
  assert.equal(odoo.calls.at(-1).cookie, 'session_id=full')
})

test('wrong TOTP code raises invalid_totp with the Odoo message', async () => {
  const odoo = fakeOdoo({
    'GET /web/login/totp': () => fakeResponse({ text: TOTP_FORM }),
    'POST /web/login/totp': () =>
      fakeResponse({ text: TOTP_FORM + '<p class="alert alert-danger" role="alert">Verification failed, please double-check the 6-digit code</p>' }),
  })
  const web = createOdooWebLogin({ baseUrl: 'https://odoo.test', db: 'db', fetchImpl: odoo.fetchImpl })
  const jar = { header: () => 'session_id=pre', store() {} }
  await assert.rejects(web.verifyTotp(jar, '000000'), (e) => e.code === 'invalid_totp' && /Verification failed/.test(e.message))
})

test('wrong password maps to invalid_credentials; account without 2FA returns uid', async () => {
  const bad = fakeOdoo({
    'POST /web/session/authenticate': () =>
      fakeResponse({ json: { error: { data: { name: 'odoo.exceptions.AccessDenied', message: 'Wrong login/password' } } } }),
  })
  const web = createOdooWebLogin({ baseUrl: 'https://odoo.test', db: 'db', fetchImpl: bad.fetchImpl })
  await assert.rejects(web.startLogin('a', 'b'), (e) => e.code === 'invalid_credentials')

  const noMfa = fakeOdoo({
    'POST /web/session/authenticate': () => fakeResponse({ json: { result: { uid: 9 } } }),
    'GET /web/session/logout': () => fakeResponse({ status: 303 }),
  })
  const web2 = createOdooWebLogin({ baseUrl: 'https://odoo.test', db: 'db', fetchImpl: noMfa.fetchImpl })
  assert.deepEqual(await web2.startLogin('a', 'b'), { mfaRequired: false, uid: 9 })
})

test('session store: 90-day expiry, only token hash stored, daily recheck', () => {
  let clock = 1_000_000
  const db = new Database(':memory:')
  const store = createSessionStore(db, { now: () => clock })
  const token = store.create({ uid: 7, login: 'a@b.c', name: 'A' })

  assert.equal(db.prepare('SELECT COUNT(*) n FROM app_sessions WHERE token_hash = ?').get(token).n, 0)
  const row = store.get(token)
  assert.equal(row.uid, 7)
  assert.equal(row.expires_at - row.created_at, 90 * DAY)
  assert.equal(store.needsRecheck(row), false)

  clock += DAY
  assert.equal(store.needsRecheck(store.get(token)), true)
  clock += 89 * DAY
  assert.equal(store.get(token), null)
  assert.equal(store.get('nope'), null)
})

test('isPublicRequest / parseCookies', () => {
  const req = (path, method = 'GET') => ({ path, method })
  assert.equal(isPublicRequest(req('/login')), true)
  assert.equal(isPublicRequest(req('/assets/index-abc.js')), true)
  assert.equal(isPublicRequest(req('/api/auth/me')), true)
  assert.equal(isPublicRequest(req('/index.html')), false)
  assert.equal(isPublicRequest(req('/')), false)
  assert.equal(isPublicRequest(req('/abc-analysis')), false)
  assert.equal(isPublicRequest(req('/api/picking/x.json')), false)
  assert.deepEqual(parseCookies('a=1; lb_session=x%3Dy'), { a: '1', lb_session: 'x=y' })
})

async function startApp({ webLogin, users, now }) {
  const sessions = createSessionStore(new Database(':memory:'), { now })
  const auth = createAuth({ sessions, webLogin, getUser: async (uid) => users[uid] ?? null, now })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', auth.router)
  app.use(auth.gate)
  app.get('/api/data', (req, res) => res.json({ user: req.user.login }))
  app.get('/abc-analysis', (req, res) => res.send('page'))
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (path, { method = 'GET', body, cookie } = {}) =>
    fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  return { server, call }
}

const cookieOf = (res, name) =>
  res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`))

test('gate: blocks without session, full 2FA login grants a 90-day cookie', async () => {
  let clock = Date.now()
  const webLogin = {
    startLogin: async (login, password) => {
      if (password !== 'pw') throw new OdooLoginError('invalid_credentials', 'Sai')
      return { mfaRequired: true, jar: {} }
    },
    verifyTotp: async (jar, code) => {
      if (code !== '123456') throw new OdooLoginError('invalid_totp', 'Mã sai')
      return 7
    },
  }
  const users = { 7: { id: 7, login: 'a@b.c', name: 'A', active: true, share: false } }
  const { server, call } = await startApp({ webLogin, users, now: () => clock })
  try {
    assert.equal((await call('/api/data')).status, 401)
    const page = await call('/abc-analysis?x=1')
    assert.equal(page.status, 302)
    assert.equal(page.headers.get('location'), '/login?next=%2Fabc-analysis%3Fx%3D1')

    assert.equal((await call('/api/auth/login', { method: 'POST', body: { login: 'a@b.c', password: 'x' } })).status, 401)
    const step1 = await call('/api/auth/login', { method: 'POST', body: { login: 'a@b.c', password: 'pw' } })
    assert.deepEqual(await step1.json(), { step: 'totp' })
    const pending = cookieOf(step1, 'lb_login_pending')

    assert.equal((await call('/api/auth/totp', { method: 'POST', body: { code: '123456' } })).status, 401)
    assert.equal((await call('/api/auth/totp', { method: 'POST', body: { code: '000000' }, cookie: pending })).status, 401)
    const step2 = await call('/api/auth/totp', { method: 'POST', body: { code: '123456' }, cookie: pending })
    assert.equal(step2.status, 200)
    const setCookie = step2.headers.getSetCookie().find((c) => c.startsWith('lb_session='))
    assert.match(setCookie, /Max-Age=7776000/)
    assert.match(setCookie, /HttpOnly/)
    const session = cookieOf(step2, 'lb_session')

    const ok = await call('/api/data', { cookie: session })
    assert.deepEqual(await ok.json(), { user: 'a@b.c' })
    assert.equal((await call('/api/auth/me', { cookie: session })).status, 200)

    // Archived in Odoo → revoked at the next daily check.
    users[7].active = false
    clock += DAY + 1000
    assert.equal((await call('/api/data', { cookie: session })).status, 401)
    assert.equal((await call('/api/auth/me', { cookie: session })).status, 401)
  } finally {
    server.close()
  }
})

test('login rejects accounts without 2FA, portal users and TOTP brute force', async () => {
  const users = { 7: { id: 7, login: 'p@x', name: 'P', active: true, share: true } }
  let mfa = false
  const webLogin = {
    startLogin: async () => (mfa ? { mfaRequired: true, jar: {} } : { mfaRequired: false, uid: 7 }),
    verifyTotp: async (jar, code) => {
      if (code !== '123456') throw new OdooLoginError('invalid_totp', 'Mã sai')
      return 7
    },
  }
  const { server, call } = await startApp({ webLogin, users, now: () => Date.now() })
  try {
    const noMfa = await call('/api/auth/login', { method: 'POST', body: { login: 'p@x', password: 'pw' } })
    assert.equal(noMfa.status, 403)
    assert.equal((await noMfa.json()).code, 'totp_not_enabled')

    mfa = true
    let pending = cookieOf(await call('/api/auth/login', { method: 'POST', body: { login: 'p@x', password: 'pw' } }), 'lb_login_pending')
    const portal = await call('/api/auth/totp', { method: 'POST', body: { code: '123456' }, cookie: pending })
    assert.equal(portal.status, 403)
    assert.equal(cookieOf(portal, 'lb_session'), undefined)

    pending = cookieOf(await call('/api/auth/login', { method: 'POST', body: { login: 'p@x', password: 'pw' } }), 'lb_login_pending')
    for (let i = 0; i < 5; i++) {
      assert.equal((await call('/api/auth/totp', { method: 'POST', body: { code: '000000' }, cookie: pending })).status, 401)
    }
    assert.equal((await call('/api/auth/totp', { method: 'POST', body: { code: '123456' }, cookie: pending })).status, 429)
  } finally {
    server.close()
  }
})
