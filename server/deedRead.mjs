// Turns page images into land-description calls with a vision model. Pure helpers are exported so they can be tested
// without the network; the HTTP call lives in readDeed().

import { failing, feedback, merge } from './refine.mjs'

export const PROMPT = `Transcribe every land description (tract) on these pages into JSON. The pages may be deeds (words) or plats / survey drawings (lines labelled with bearings and distances, line tables, area tables). Read digits exactly as printed; never correct, infer or "fix" a number. If a digit is unreadable use null.
Return ONLY JSON: {"tracts":[{"label":string,"statedAcres":number|null,"notes":string,"calls":[{"ns":"N"|"S","ew":"E"|"W","deg":number|null,"min":number,"sec":number,"distance":number,"text":string}]}]}
Rules for every tract:
- "calls" is the boundary of that one parcel or lot as a single closed ring, in order, going once around from any corner; the last call ends where the first began. Do not leave gaps and do not list any line twice.
- On a plat, take each side's bearing and distance from its label on the drawing or from the line table (L1, L2, ...). Use a table line only where that line is part of this lot's boundary.
- Where a side is printed as a TOTAL with partial distances, use the TOTAL once and not the partials as well.
- A line shared by two lots has one printed bearing. For the lot that walks it the opposite way round, flip both letters (N<->S, E<->W) and keep the numbers.
- statedAcres is the area printed for that lot (convert square feet to acres by dividing by 43560 only if no acreage is printed).
- Leave curves out of "calls" and describe them in "notes". "text" is the call as printed.
- If a page has no bearings and distances (words only, or a lot reference), return the tract with an empty "calls" list and say so in "notes". Never invent calls.`

/** Pull the JSON out of a model reply and coerce it to the Tract/Call shape of src/lib/deedcalls.ts. Throws on junk. */
export function parseReply(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('no JSON in reply')
  const raw = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(raw.tracts)) throw new Error('no tracts in reply')
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return raw.tracts.map((t, i) => ({
    label: String(t.label ?? `Tract ${i + 1}`),
    statedAcres: num(t.statedAcres),
    notes: String(t.notes ?? ''),
    calls: (Array.isArray(t.calls) ? t.calls : [])
      .filter((c) => (c.ns === 'N' || c.ns === 'S') && (c.ew === 'E' || c.ew === 'W') && num(c.distance) !== null && c.distance > 0)
      .map((c) => ({
        ns: c.ns, ew: c.ew,
        deg: num(c.deg), min: num(c.min) ?? 0, sec: num(c.sec) ?? 0,
        distance: c.distance,
        unsure: num(c.deg) === null,
        text: String(c.text ?? ''),
      })),
  }))
}

/** The points file is context only: calls are copied from the page, never adjusted to fit the points. */
const POINTS_NOTE = `Also attached: the surveyor's field points file (point, northing, easting, elevation, description). It is context only. Never change, add or drop a digit of any call to fit it; transcribe only what the pages print.`
const MAX_POINTS_CHARS = 200_000

async function ask(messages, { apiKey, model }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 16000, messages }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message ?? `model API ${r.status}`)
  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  const blocks = (j.content ?? []).map((b) => b.type).join(',') || 'none'
  try {
    return { text, tracts: parseReply(text), usage: j.usage }
  } catch (e) {
    throw new Error(`${e.message} (stop_reason ${j.stop_reason}, blocks ${blocks}, reply starts: ${JSON.stringify(text.slice(0, 200))})`)
  }
}

const addUsage = (a, b) => ({ input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0) })

export async function readDeed(images, { apiKey, model, points }) {
  const content = [
    ...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })),
    { type: 'text', text: PROMPT },
    ...(points ? [{ type: 'text', text: `${POINTS_NOTE}\n\n${points.slice(0, MAX_POINTS_CHARS)}` }] : []),
  ]
  const t0 = Date.now()
  const messages = [{ role: 'user', content }]
  const first = await ask(messages, { apiKey, model })
  let tracts = first.tracts
  let usage = first.usage
  let rereads = 0
  // the app's own checks decide whether a description needs a second look; one re-read, never a loop
  const bad = failing(tracts)
  if (bad.length > 0) {
    try {
      const second = await ask([...messages, { role: 'assistant', content: first.text }, { role: 'user', content: feedback(tracts, bad) }], { apiKey, model })
      tracts = merge(tracts, second.tracts, bad)
      usage = addUsage(usage, second.usage)
      rereads = 1
    } catch {
      // the first reading stands; it is still checked by the app
    }
  }
  return { tracts, seconds: (Date.now() - t0) / 1000, usage, rereads }
}
