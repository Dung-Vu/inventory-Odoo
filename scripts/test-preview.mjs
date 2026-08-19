// Tiny smoke-test script for the generate-lots endpoint.
// Used during development; not shipped to production.

const TARGET = process.env.TARGET || 'http://localhost:5099'
const PICKING = process.env.PICKING || 'O-MID/IN/00282'

const url = `${TARGET}/api/generate-lots/${process.env.MODE || 'preview'}`
const body = JSON.stringify({ pickingName: PICKING })

console.log(`POST ${url}`)
console.log(`body: ${body}`)

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
})

const text = await res.text()
console.log(`status: ${res.status}`)
try {
  console.log('response JSON:')
  console.log(JSON.stringify(JSON.parse(text), null, 2))
} catch {
  console.log('response text:', text)
}
