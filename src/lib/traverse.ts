import type { Call } from './deedcalls.ts'

export interface Vertex {
  e: number
  n: number
}

export interface Traverse {
  /** The corners in order, starting at (0, 0). A description that closes ends where it started. */
  vertices: Vertex[]
  perimeter: number
  /** How far the last corner is from the first, in feet. */
  misclosure: number
  /** 1 in this many (perimeter over misclosure); Infinity when it closes exactly. */
  ratio: number
  areaSqFt: number
  areaAcres: number
}

const azimuth = (c: Call): number => {
  const a = (c.deg ?? 0) + c.min / 60 + c.sec / 3600
  if (c.ns === 'N') return c.ew === 'E' ? a : 360 - a
  return c.ew === 'E' ? 180 - a : 180 + a
}

/** Walk the calls from (0, 0). Calls whose bearing could not be read are skipped (the verdict says so). */
export function traverse(calls: Call[]): Traverse | null {
  const usable = calls.filter((c) => c.deg !== null)
  if (usable.length < 2) return null
  const vertices: Vertex[] = [{ e: 0, n: 0 }]
  let perimeter = 0
  for (const c of usable) {
    const last = vertices[vertices.length - 1]
    const r = (azimuth(c) * Math.PI) / 180
    vertices.push({ e: last.e + c.distance * Math.sin(r), n: last.n + c.distance * Math.cos(r) })
    perimeter += c.distance
  }
  const end = vertices[vertices.length - 1]
  const misclosure = Math.hypot(end.e, end.n)
  let twice = 0
  vertices.forEach((p, i) => {
    const q = vertices[(i + 1) % vertices.length]
    twice += p.e * q.n - q.e * p.n
  })
  const areaSqFt = Math.abs(twice) / 2
  return { vertices, perimeter, misclosure, ratio: misclosure < 0.005 ? Infinity : perimeter / misclosure, areaSqFt, areaAcres: areaSqFt / 43560 }
}

/** Closer than this (1 in N) counts as closing. Surveys of this kind close well beyond it; deeds that miss it were misread or do not close. */
export const MIN_CLOSURE_RATIO = 400
/** How far the computed area may differ from the stated acreage. */
export const MAX_ACREAGE_DIFFERENCE = 0.03

export type Verdict = 'ok' | 'check' | 'fail'

export interface Assessment {
  verdict: Verdict
  reasons: string[]
  traverse: Traverse | null
}

/**
 * Is this read to be trusted? 'ok' closes and matches the stated acreage; 'check' is plausible but something was inferred;
 * 'fail' does not close, does not match the acreage, or could not be read in full. Nothing is drawn from a 'fail'.
 */
export function assess(calls: Call[], statedAcres: number | null): Assessment {
  const t = traverse(calls)
  const reasons: string[] = []
  const unreadable = calls.filter((c) => c.deg === null).length
  if (calls.length < 3 || !t) return { verdict: 'fail', reasons: ['fewer than three calls could be read'], traverse: t }
  if (unreadable > 0) reasons.push(`${unreadable} ${unreadable === 1 ? 'bearing' : 'bearings'} could not be read`)
  if (t.ratio < MIN_CLOSURE_RATIO) reasons.push(`does not close: ${t.misclosure.toFixed(1)} ft off over ${t.perimeter.toFixed(0)} ft (1 in ${Math.round(t.ratio)})`)
  if (statedAcres !== null && Math.abs(t.areaAcres - statedAcres) / statedAcres > MAX_ACREAGE_DIFFERENCE) {
    reasons.push(`area ${t.areaAcres.toFixed(2)} acres, but the deed says ${statedAcres}`)
  }
  if (reasons.length > 0) return { verdict: 'fail', reasons, traverse: t }
  const inferred = calls.filter((c) => c.inferred).length
  if (inferred > 0) return { verdict: 'check', reasons: [`${inferred} ${inferred === 1 ? 'bearing was' : 'bearings were'} filled in from the opposite side`], traverse: t }
  return { verdict: 'ok', reasons: [], traverse: t }
}
