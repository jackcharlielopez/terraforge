// Optional local backend: `npm run server`. Holds the model API key so the browser never sees it.
// The deployed (GitHub Pages) build has the AI_READ flag off and never calls this.
import http from 'node:http'
import { readDeed } from './deedRead.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const MODEL = process.env.AI_MODEL ?? 'claude-sonnet-5-5'
const MAX_BYTES = 40 * 1024 * 1024
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

http.createServer(async (req, res) => {
  // Local only: no CORS headers; the Vite dev proxy makes it same-origin.
  if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, keySet: !!process.env.ANTHROPIC_API_KEY, model: MODEL })
  if (req.method !== 'POST' || req.url !== '/api/process') return send(res, 404, { error: 'not found' })
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: 'ANTHROPIC_API_KEY is not set on the server' })
  try {
    const chunks = []
    let size = 0
    for await (const c of req) { size += c.length; if (size > MAX_BYTES) return send(res, 413, { error: 'too large' }); chunks.push(c) }
    const { deeds, points } = JSON.parse(Buffer.concat(chunks).toString())
    const ok = Array.isArray(deeds) && deeds.length > 0 && deeds.every((d) => d && typeof d.id === 'string' && Array.isArray(d.images) && d.images.length > 0 && d.images.every((x) => typeof x === 'string'))
    if (!ok) return send(res, 400, { error: 'deeds: [{id, images: [base64 PNG]}] required' })
    const opts = { apiKey: process.env.ANTHROPIC_API_KEY, model: MODEL, points: typeof points === 'string' ? points : '' }
    const t0 = Date.now()
    // every deed is its own model call (so a read can never mix two deeds), all started together and answered in one response;
    // one deed failing is reported on that deed and does not throw away the others
    const results = await Promise.all(deeds.map((d) => readDeed(d.images, opts).then((r) => ({ id: d.id, ...r }), (e) => ({ id: d.id, error: e instanceof Error ? e.message : String(e) }))))
    send(res, 200, { results, seconds: (Date.now() - t0) / 1000 })
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`TerraForge server on http://127.0.0.1:${PORT}`))
