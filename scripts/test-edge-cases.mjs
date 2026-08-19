// Edge-case smoke tests for the generate-lots endpoint.

const TARGET = process.env.TARGET || 'http://localhost:5099'

async function post(path, body) {
  const res = await fetch(`${TARGET}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, body: parsed }
}

async function get(path) {
  const res = await fetch(`${TARGET}${path}`)
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, body: parsed }
}

const results = []
function log(name, r) {
  results.push({ name, ...r })
  console.log(`\n[${name}] status=${r.status}`)
  console.log(JSON.stringify(r.body, null, 2).slice(0, 800))
}

// 1) Empty body → 400
log('preview-empty-body', await post('/api/generate-lots/preview', {}))

// 2) Non-existent picking → 404
log('preview-not-found', await post('/api/generate-lots/preview', { pickingName: 'DOES-NOT-EXIST-XYZ' }))

// 3) Numeric ID path → should still work (it's a real ID)
log('preview-by-id-16910', await post('/api/generate-lots/preview', { pickingName: '16910' }))

// 4) GET /health sanity
log('health', await get('/health'))

console.log('\n=== Summary ===')
for (const r of results) console.log(`${r.name}: ${r.status}`)
