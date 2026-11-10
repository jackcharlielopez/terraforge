import type { Call } from './deedcalls.ts'
import { MAX_ACREAGE_DIFFERENCE, traverse } from './traverse.ts'

const toRadians = (deg: number) => (deg * Math.PI) / 180
const azimuthOf = (c: Call): number => {
  const a = (c.deg ?? 0) + c.min / 60 + c.sec / 3600
  return c.ns === 'N' ? (c.ew === 'E' ? a : 360 - a) : c.ew === 'E' ? 180 - a : 180 + a
}

/** A bearing (whole degrees, minutes) from a compass azimuth, rounded to the nearest minute. */
function bearingOf(az: number): { ns: 'N' | 'S'; ew: 'E' | 'W'; deg: number; min: number; sec: number } {
  const a = ((az % 360) + 360) % 360
  const [ns, ew, angle] = a <= 90 ? (['N', 'E', a] as const) : a <= 180 ? (['S', 'E', 180 - a] as const) : a <= 270 ? (['S', 'W', a - 180] as const) : (['N', 'W', 360 - a] as const)
  let minutes = Math.round(angle * 60)
  const deg = Math.floor(minutes / 60)
  minutes -= deg * 60
  return { ns, ew, deg, min: minutes, sec: 0 }
}

/** The east and north a call spans (straight lines and curve chords alike). */
const vector = (c: Call): [number, number] => {
  const r = toRadians(azimuthOf(c))
  return [c.distance * Math.sin(r), c.distance * Math.cos(r)]
}

export interface ClosingCall {
  ns: 'N' | 'S'
  ew: 'E' | 'W'
  deg: number
  min: number
  distance: number
}

/**
 * The call that would close the description: from where the last call ends back to where the first began. The surveyor reads it as a hint
 * ("the calls leave a gap of 129 ft, and a call S 56° W 700' would close it"): a description whose last call was lost or never written
 * ("... to the beginning") shows its missing call here. Null when the calls already close, or too few were readable.
 */
export function closingCall(calls: Call[]): ClosingCall | null {
  const usable = calls.filter((c) => c.deg !== null)
  if (usable.length < 2) return null
  let e = 0
  let n = 0
  for (const c of usable) {
    const [de, dn] = vector(c)
    e += de
    n += dn
  }
  const distance = Math.hypot(e, n)
  if (distance < 0.5) return null
  const b = bearingOf((Math.atan2(-e, -n) * 180) / Math.PI)
  return { ns: b.ns, ew: b.ew, deg: b.deg, min: b.min, distance }
}

/** How far the printed distance may differ from the gap the other calls leave: a bearing solved from a gap of the wrong length is a guess. */
const DISTANCE_TOLERANCE_FEET = 3
const DISTANCE_TOLERANCE_SHARE = 0.01

/**
 * One call whose bearing could not be read, with every other call readable, has a bearing the rest of the description determines: it is
 * the direction of the gap they leave. Two things independent of that choice have to agree before it is used: the printed distance must
 * match the length of the gap (one number in, one number out), and the area must match the stated acreage when there is one. The result is
 * marked inferred, so it is a "check" for the surveyor and never trusted on its own. With two or more unreadable bearings there is nothing to go on.
 */
export function solveUnreadable(calls: Call[], statedAcres: number | null): Call[] {
  const bad = calls.map((c, i) => (c.deg === null && !c.inferred ? i : -1)).filter((i) => i >= 0)
  if (bad.length !== 1 || calls.some((c, i) => i !== bad[0] && c.deg === null)) return calls
  const target = calls[bad[0]]
  if (target.curve) return calls
  let e = 0
  let n = 0
  for (const [i, c] of calls.entries()) {
    if (i === bad[0]) continue
    const [de, dn] = vector(c)
    e += de
    n += dn
  }
  const gap = Math.hypot(e, n)
  if (Math.abs(gap - target.distance) > Math.max(DISTANCE_TOLERANCE_FEET, DISTANCE_TOLERANCE_SHARE * target.distance)) return calls
  const b = bearingOf((Math.atan2(-e, -n) * 180) / Math.PI)
  const solved = calls.map((c, i) => (i === bad[0] ? { ...c, ...b, unsure: false, inferred: `bearing solved from closure: ${b.ns} ${b.deg}° ${String(b.min).padStart(2, '0')}' ${b.ew}` } : c))
  const t = traverse(solved)
  if (statedAcres !== null && t && Math.abs(t.areaAcres - statedAcres) / statedAcres > MAX_ACREAGE_DIFFERENCE) return calls
  return solved
}
