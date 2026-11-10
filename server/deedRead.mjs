// Turns page images into land-description calls with a vision model. Pure helpers are exported so they can be tested
// without the network; the HTTP call lives in readDeed().

import { failing, feedback, merge } from './refine.mjs'

export const PROMPT = `Transcribe every land description (tract) on these pages into JSON. The pages may be deeds (words) or plats / survey drawings (lines labelled with bearings and distances, line tables, area tables). Read digits exactly as printed; never correct, infer or "fix" a number. If a digit is unreadable use null.
Return ONLY JSON:
{"tracts":[{"label":string,"descriptionType":"metes_and_bounds"|"lot_reference"|"aliquot"|"centerline"|"blanket"|"exhibit_referenced"|"facility_relative"|"words_only","unit":"feet"|"chains"|"rods"|"poles"|"perches"|"links"|"varas"|"yards"|"meters"|"arpents"|"miles"|"kilometers"|"inches","statedArea":{"value":number,"unit":"acres"|"sqft"|"sqm"|"ha"|"arpents"}|null,"notes":string,"calls":[{"ns":"N"|"S","ew":"E"|"W","deg":number|null,"min":number,"sec":number,"distance":number,"confidence":"high"|"medium"|"low","text":string,"curve":null|{"radius":number,"direction":"L"|"R","arcLength":number|null}}]}]}
Rules for every tract:
- "calls" is the boundary of that one parcel or lot as a single closed ring, in order, going once around from any corner; the last call ends where the first began. Do not leave gaps and do not list any line twice.
- Give distances, radii and arc lengths in the unit the document prints, and say that unit in "unit" (default feet). Give "statedArea" as printed, with its own unit; do not convert it.
- A curve is a call too. Its ns/deg/min/sec and "distance" are the CHORD bearing and chord length; "curve" gives the radius, "L" if the line turns left as it is walked or "R" if it turns right, and the arc length if printed (else null). If a curve prints only a radius and an arc length, or only a radial bearing, put what is printed in "text", give the chord only if it is printed or you can read it, and set "confidence" to "low". Non-curve calls have "curve": null.
- "confidence" is "low" when a digit is faint, damaged, smudged or ambiguous (6/8, 1/7, 3/5), "medium" when the page is clear but the call is hard to place, otherwise "high". Never guess a digit to raise it.
- On a plat, take each side's bearing and distance from its label on the drawing or from the line table (L1, L2, ...). Use a table line only where that line is part of this lot's boundary.
- Where a side is printed as a TOTAL with partial distances, use the TOTAL once and not the partials as well.
- A line shared by two lots has one printed bearing. For the lot that walks it the opposite way round, flip both letters (N<->S, E<->W) and keep the numbers.
- "descriptionType": metes_and_bounds when bearings and distances are given; lot_reference for "Lot N of ... Plat Book X"; aliquot for section/quarter descriptions; words_only for an easement or text with no measurements; exhibit_referenced when it points to an attached exhibit.
- If a page has no bearings and distances, return the tract with an empty "calls" list and say so in "notes". Never invent calls.
- "text" is the call as printed.`

/** Feet in one of each distance unit (US survey foot; the arpent is the Louisiana 192 ft one, the vara the Texas 33 1/3 inch one). */
export const FEET_PER = { feet: 1, inches: 1 / 12, yards: 3, miles: 5280, chains: 66, links: 0.66, rods: 16.5, poles: 16.5, perches: 16.5, varas: 100 / 36, meters: 3937 / 1200, kilometers: 3937000 / 1200, arpents: 192 }
/** Acres in one of each area unit. */
export const ACRES_PER = { acres: 1, sqft: 1 / 43560, sqm: 1 / 4046.8564224, ha: 2.4710538147, arpents: 0.84625 }

const DESCRIPTION_TYPES = new Set(['metes_and_bounds', 'lot_reference', 'aliquot', 'centerline', 'blanket', 'exhibit_referenced', 'facility_relative', 'words_only'])
const CONFIDENCES = new Set(['high', 'medium', 'low'])

/** The numbers in a piece of text, reading "139 1/2", "139 ½" as 139.5 and "1,088.27" as 1088.27. */
export function numbersIn(text) {
  const t = String(text)
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d+)\s*(?:1\/2|½)/g, (_, n) => String(Number(n) + 0.5))
    .replace(/(\d+)\s*(?:1\/4|¼)/g, (_, n) => String(Number(n) + 0.25))
    .replace(/(\d+)\s*(?:3\/4|¾)/g, (_, n) => String(Number(n) + 0.75))
  return [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
}

/**
 * The model writes each call twice, as the page prints it ("text") and as numbers. A distance that is in neither form of the other
 * means a slip in one of them, and which one is not known: the call is marked low confidence. Returns the reason, or null.
 */
export function textDisagrees(text, distance, arcLength) {
  const n = numbersIn(text)
  if (n.length === 0) return null // no text to compare with
  const has = (x) => n.some((v) => Math.abs(v - x) < 0.006)
  if (has(distance) || (arcLength !== null && arcLength !== undefined && has(arcLength))) return null
  return `the distance read (${distance}) is not in the transcribed text`
}

/** Pull the JSON out of a model reply and coerce it to the Tract/Call shape of src/lib/deedcalls.ts (distances in feet, area in acres). Throws on junk. */
export function parseReply(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('no JSON in reply')
  const raw = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(raw.tracts)) throw new Error('no tracts in reply')
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return raw.tracts.map((t, i) => {
    const f = Object.hasOwn(FEET_PER, t.unit) ? FEET_PER[t.unit] : 1
    // an area in its own unit becomes acres; the older plain "statedAcres" still reads
    const area = t.statedArea && num(t.statedArea.value) !== null && Object.hasOwn(ACRES_PER, t.statedArea.unit) ? t.statedArea.value * ACRES_PER[t.statedArea.unit] : num(t.statedAcres)
    const calls = (Array.isArray(t.calls) ? t.calls : [])
      .filter((c) => (c.ns === 'N' || c.ns === 'S') && (c.ew === 'E' || c.ew === 'W') && num(c.distance) !== null && c.distance > 0)
      .map((c) => {
        // a bearing that cannot exist (over 90 degrees, 60 or more minutes or seconds) is unreadable, not something to guess at
        const min = num(c.min) ?? 0
        const sec = num(c.sec) ?? 0
        const deg = num(c.deg) !== null && c.deg >= 0 && c.deg <= 90 && min >= 0 && min < 60 && sec >= 0 && sec < 60 ? c.deg : null
        const call = { ns: c.ns, ew: c.ew, deg, min, sec, distance: c.distance * f, unsure: deg === null, text: String(c.text ?? '') }
        if (CONFIDENCES.has(c.confidence)) call.confidence = c.confidence
        const slip = textDisagrees(c.text, c.distance, c.curve?.arcLength)
        if (slip) {
          call.confidence = 'low'
          call.note = slip
        }
        if (c.curve && num(c.curve.radius) !== null && c.curve.radius > 0 && (c.curve.direction === 'L' || c.curve.direction === 'R')) {
          call.curve = { radius: c.curve.radius * f, direction: c.curve.direction }
          if (num(c.curve.arcLength) !== null && c.curve.arcLength > 0) call.curve.arcLength = c.curve.arcLength * f
        }
        return call
      })
    return {
      label: String(t.label ?? `Tract ${i + 1}`),
      statedAcres: area,
      notes: String(t.notes ?? ''),
      descriptionType: DESCRIPTION_TYPES.has(t.descriptionType) ? t.descriptionType : calls.length > 0 ? 'metes_and_bounds' : 'words_only',
      calls,
    }
  })
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
