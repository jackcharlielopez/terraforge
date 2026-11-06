import type { CodeDef, PointMatch, Polyline, SurveyPoint } from './types.ts'

export interface Annotation {
  layer: string
  x: number
  y: number
  z: number
  /** Text height in drawing units. */
  height: number
  /** Degrees counter-clockwise from east, kept in -90..90 so the text reads left to right. */
  rotation: number
  /** Display text with a real degree sign. */
  text: string
  /** The same text for a CAD file (%%d is AutoCAD's degree code), which R12 can store as plain ASCII. */
  cad: string
}

export interface Course {
  from: string
  to: string
  bearing: string
  bearingCad: string
  distance: number
}

export interface Boundary {
  polyline: Polyline
  labels: Annotation[]
  courses: Course[]
  /** Square feet (drawing units squared). */
  area: number
  perimeter: number
}

export interface Candidate {
  no: string
  desc: string
  e: number
  n: number
  /** Cap number from the description ("IPF#1670" -> "1670"), if any. */
  capId: string | null
  /** A pin set on this job (IPS, IRS...), as opposed to one found. */
  isSet: boolean
}

export const BOUNDARY_LAYER = 'V-PROP'
export const BEARING_LAYER = 'BRGTXT'
const LABEL_HEIGHT = 5

/** Points whose code is flagged as a possible boundary monument in the dictionary. */
export function findCandidates(points: SurveyPoint[], matches: PointMatch[], defs: Map<string, CodeDef>): Candidate[] {
  const out: Candidate[] = []
  points.forEach((p, i) => {
    if (!matches[i].codes.some((c) => defs.get(c)?.boundary)) return
    out.push({
      no: p.no,
      desc: p.desc,
      e: p.e,
      n: p.n,
      capId: /#\s*(\d+)/.exec(p.desc)?.[1] ?? null,
      isSet: /^(IPS|IRS|CPS)\b/i.test(p.desc),
    })
  })
  return out
}

/**
 * A starting guess, not an answer: the pins carrying the most common cap number (usually the
 * surveyor's own license number) plus any pins set on this job. A pin on the same line, an
 * adjoiner's corner, or a witness pin can share that number, so the area is always shown to be checked.
 */
export function suggestBoundary(cands: Candidate[]): string[] {
  const byId = new Map<string, Candidate[]>()
  for (const c of cands) if (c.capId) byId.set(c.capId, [...(byId.get(c.capId) ?? []), c])
  const best = [...byId.values()].sort((a, b) => b.length - a.length)[0] ?? []
  const picked = new Set(best.map((c) => c.no))
  for (const c of cands) if (c.isSet) picked.add(c.no)
  // A pin sitting on the straight extension of a side beyond its end (a line or witness pin) is not a corner: it would
  // push a notch into the outline, so it is left for the surveyor to tick if it is one.
  // One at a time, the outermost first: three pins on one line each look like the odd one out against the others.
  const chosen = cands.filter((c) => picked.has(c.no))
  for (;;) {
    const cx = chosen.reduce((a, c) => a + c.e, 0) / chosen.length
    const cy = chosen.reduce((a, c) => a + c.n, 0) / chosen.length
    const linePins = chosen.filter((c) => isLinePin(c, chosen.filter((o) => o !== c)))
    if (linePins.length === 0) break
    const far = linePins.sort((a, b) => Math.hypot(b.e - cx, b.n - cy) - Math.hypot(a.e - cx, a.n - cy))[0]
    chosen.splice(chosen.indexOf(far), 1)
  }
  return chosen.map((c) => c.no)
}

/** Within this many feet of the line through a side counts as being on it (shot noise). */
const ON_LINE_FEET = 3

/** True when `p` lies on the extension of a side of the outline made by `others`, outside the side itself. */
function isLinePin(p: Candidate, others: Candidate[]): boolean {
  if (others.length < 3) return false
  const cx = others.reduce((a, o) => a + o.e, 0) / others.length
  const cy = others.reduce((a, o) => a + o.n, 0) / others.length
  const ring = [...others].sort((a, b) => Math.atan2(a.n - cy, a.e - cx) - Math.atan2(b.n - cy, b.e - cx))
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]
    const dx = b.e - a.e
    const dy = b.n - a.n
    const len = Math.hypot(dx, dy)
    if (len === 0) return false
    const t = ((p.e - a.e) * dx + (p.n - a.n) * dy) / (len * len)
    const off = Math.abs((p.e - a.e) * dy - (p.n - a.n) * dx) / len
    return off <= ON_LINE_FEET && (t < 0 || t > 1)
  })
}

/**
 * The closed property line through the chosen pins, taken in order around their centre
 * (the artifact's "sort around"), with area, perimeter and bearing/distance for each course.
 */
export function buildBoundary(points: SurveyPoint[], nos: Iterable<string>): Boundary | null {
  const wanted = new Set(nos)
  const pins = points.filter((p) => wanted.has(p.no))
  if (pins.length < 3) return null

  const cx = pins.reduce((a, p) => a + p.e, 0) / pins.length
  const cy = pins.reduce((a, p) => a + p.n, 0) / pins.length
  pins.sort((a, b) => Math.atan2(a.n - cy, a.e - cx) - Math.atan2(b.n - cy, b.e - cx))
  return outline(pins.map((p) => ({ e: p.e, n: p.n, z: p.z, name: p.no })))
}

/** A boundary through corners already in order (a computed deed outline), with area, perimeter and bearing/distance labels. */
export function outline(corners: Array<{ e: number; n: number; z: number; name: string }>): Boundary | null {
  if (corners.length < 3) return null
  let twice = 0
  let perimeter = 0
  const courses: Course[] = []
  const labels: Annotation[] = []
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % corners.length]
    twice += p.e * q.n - q.e * p.n
    const dn = q.n - p.n
    const de = q.e - p.e
    const distance = Math.hypot(de, dn)
    perimeter += distance
    const b = formatBearing(dn, de)
    courses.push({ from: p.name, to: q.name, bearing: b.text, bearingCad: b.cad, distance })

    // Label above the line, rotated along it, never upside down.
    let rot = (Math.atan2(dn, de) * 180) / Math.PI
    if (rot > 90) rot -= 180
    if (rot < -90) rot += 180
    const rad = (rot * Math.PI) / 180
    const off = LABEL_HEIGHT * 1.1
    const mx = (p.e + q.e) / 2 - Math.sin(rad) * off
    const my = (p.n + q.n) / 2 + Math.cos(rad) * off
    const dist = `${distance.toFixed(2)}'`
    labels.push({ layer: BEARING_LAYER, x: mx, y: my, z: 0, height: LABEL_HEIGHT, rotation: rot, text: `${b.text} ${dist}`, cad: `${b.cad} ${dist}` })
  })

  return {
    polyline: { layer: BOUNDARY_LAYER, key: 'boundary', closed: true, mayCross: true, vertices: corners.map((p) => ({ e: p.e, n: p.n, z: p.z })) },
    labels,
    courses,
    area: Math.abs(twice) / 2,
    perimeter,
  }
}

/** Quadrant bearing, e.g. N 08°07'13" E. */
export function formatBearing(dn: number, de: number): { text: string; cad: string } {
  const ns = dn >= 0 ? 'N' : 'S'
  const ew = de >= 0 ? 'E' : 'W'
  const angle = (Math.atan2(Math.abs(de), Math.abs(dn)) * 180) / Math.PI
  let deg = Math.floor(angle)
  let min = Math.floor((angle - deg) * 60)
  let sec = Math.round(((angle - deg) * 60 - min) * 60)
  if (sec === 60) { sec = 0; min++ }
  if (min === 60) { min = 0; deg++ }
  const p2 = (n: number) => String(n).padStart(2, '0')
  const rest = `${p2(min)}'${p2(sec)}" ${ew}`
  return { text: `${ns} ${p2(deg)}°${rest}`, cad: `${ns} ${p2(deg)}%%d${rest}` }
}
