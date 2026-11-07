import type { Call } from './deedcalls.ts'
import { traverse } from './traverse.ts'

/** One change to one call that would make the description close. */
export interface Repair {
  /** Which call (0-based). */
  index: number
  what: 'distance' | 'degrees' | 'minutes' | 'seconds' | 'direction'
  from: string
  to: string
  /** The calls with the change made. */
  calls: Call[]
  ratio: number
  areaAcres: number
}

/** A repair must close to at least this (1 in N). Tight on purpose: with thousands of possible edits, a loose bar finds fixes by chance. */
export const MIN_REPAIR_RATIO = 5000
/** At most this many candidate repairs are offered; more than this means the data cannot say which edit is right. */
const MAX_OFFERED = 3
/** A repair must leave the area within this of the stated acreage, when there is one. */
const AREA_TOLERANCE = 0.03

const fmt = (c: Call): string => `${c.ns} ${c.deg}° ${String(c.min).padStart(2, '0')}' ${String(c.sec).padStart(2, '0')}" ${c.ew}`

/** Every number reached by changing one digit of `n`, or swapping two neighbouring digits (what OCR and typists get wrong). */
function digitVariants(n: number, decimals: number, max: number): number[] {
  const s = n.toFixed(decimals).replace('.', '')
  const out = new Set<string>()
  for (let i = 0; i < s.length; i++) {
    for (let d = 0; d <= 9; d++) if (String(d) !== s[i]) out.add(s.slice(0, i) + d + s.slice(i + 1))
    if (i + 1 < s.length && s[i] !== s[i + 1]) out.add(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2))
  }
  return [...out]
    .map((v) => Number(decimals > 0 ? v.slice(0, -decimals) + '.' + v.slice(-decimals) : v))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= max && v !== n)
}

/**
 * A description that does not close usually has one wrong number: a digit OCR misread, two digits a typist swapped (257 for 275), a
 * bearing off by a degree. Try every single-digit change and neighbouring-digit swap in every call, and every flip of a quadrant letter,
 * and keep the ones that make the description close tightly and, when the deed states an acreage, match it. Returns nothing when no
 * single edit does it, or when more than three do (then the data cannot say which one is right). The surveyor chooses; nothing is applied here.
 */
export function suggestRepairs(calls: Call[], statedAcres: number | null): Repair[] {
  if (calls.length < 3 || calls.length > 120 || calls.some((c) => c.deg === null)) return []
  const found: Repair[] = []
  const tryCall = (index: number, what: Repair['what'], from: string, to: string, changed: Call) => {
    const next = calls.map((c, i) => (i === index ? changed : c))
    const t = traverse(next)
    if (!t || t.ratio < MIN_REPAIR_RATIO) return
    if (statedAcres !== null && Math.abs(t.areaAcres - statedAcres) / statedAcres > AREA_TOLERANCE) return
    found.push({ index, what, from, to, calls: next, ratio: t.ratio, areaAcres: t.areaAcres })
  }
  calls.forEach((c, i) => {
    for (const v of digitVariants(c.distance, 2, 100000)) tryCall(i, 'distance', `${c.distance.toFixed(2)}'`, `${v.toFixed(2)}'`, { ...c, distance: v })
    for (const v of digitVariants(c.deg ?? 0, 0, 90)) tryCall(i, 'degrees', fmt(c), fmt({ ...c, deg: v }), { ...c, deg: v })
    for (const v of digitVariants(c.min, 0, 59)) tryCall(i, 'minutes', fmt(c), fmt({ ...c, min: v }), { ...c, min: v })
    for (const v of digitVariants(c.sec, 0, 59)) tryCall(i, 'seconds', fmt(c), fmt({ ...c, sec: v }), { ...c, sec: v })
    const ns = c.ns === 'N' ? 'S' : 'N'
    const ew = c.ew === 'E' ? 'W' : 'E'
    tryCall(i, 'direction', fmt(c), fmt({ ...c, ns }), { ...c, ns })
    tryCall(i, 'direction', fmt(c), fmt({ ...c, ew }), { ...c, ew })
  })
  // best closure first; a change in a quadrant letter or a distance is preferred over several equal ones in a bearing
  found.sort((a, b) => b.ratio - a.ratio)
  return found.length > 0 && found.length <= MAX_OFFERED ? found : []
}

/** The calls with a repair applied, the changed call marked so it shows in the list and the verdict asks for a check. */
export function applyRepair(calls: Call[], repair: Repair): Call[] {
  return repair.calls.map((c, i) => (i === repair.index ? { ...c, inferred: `changed from ${repair.from} to ${repair.to} to make the description close` } : calls[i]))
}
