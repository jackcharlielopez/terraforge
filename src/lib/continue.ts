import { properlyCross } from './geometry.ts'
import { mergeGapFills } from './gapfill.ts'
import type { CodeDef, PointMatch, Polyline, SurveyPoint } from './types.ts'

/** Longest join, in feet, for ends that are not lined up almost exactly. */
export const CONTINUE_GAP = 80
/** Longest join, in feet, when both lines point almost straight at each other (within `STRAIGHT_ANGLE`). */
export const CONTINUE_LONG_GAP = 150
export const STRAIGHT_ANGLE = 10
/** A join must lie within this many degrees of the way each line was heading. */
export const CONTINUE_ANGLE = 25
/** Below this a segment is too short to give a direction (survey noise), so the one before it is used. */
const HEADING_MIN_SEGMENT = 3

/** Shortest and longest cap across the mouth of a U, in feet (a driveway or walk is not narrower than a car or a person). */
export const CAP_MIN_GAP = 8
export const CAP_GAP = 40
/** Two lines capped together must run within this many degrees of parallel, facing the same way, and the cap square to them. */
export const CAP_ANGLE = 20

const keyOf = (e: number, n: number) => `${e.toFixed(3)},${n.toFixed(3)}`

interface End {
  layer: string
  /** index of the survey point at this end */
  pt: number
  /** which line it belongs to, or -1 for a loose point that is on no line */
  line: number
  /** unit vector the line was heading in as it reached this end, or null for a loose point */
  heading: [number, number] | null
}

/**
 * Join the loose ends of lines that continue each other: the end of one line to the end of another (or to a loose point) of
 * the same layer, when the second lies ahead of the first in the direction the first was heading, and the first lies ahead of
 * the second the same way. Shot order is the strongest signal and has already been used; this repairs a line that was shot in
 * pieces (a kerb shot in one pass, then again later at a driveway). Shortest first; a join may not skip over another point of
 * the layer, cross a line, or touch a point the surveyor marked to begin or close a line (an END marker is bridged only when the next piece lines up).
 */
export function continueLines(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  lines: Polyline[],
  gap = CONTINUE_GAP,
  angle = CONTINUE_ANGLE,
): Polyline[] {
  // a join can make a new line end that continues into the next piece, so repeat until nothing more joins
  let cur = lines
  for (let pass = 0; pass < 4; pass++) {
    const next = continuePass(points, matches, defs, cur, gap, angle)
    if (next === cur) break
    cur = next
  }
  return cur
}

function continuePass(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  lines: Polyline[],
  gap = CONTINUE_GAP,
  angle = CONTINUE_ANGLE,
  longGap = Math.max(gap, CONTINUE_LONG_GAP),
): Polyline[] {
  if (gap <= 0 || angle <= 0) return lines
  const index = new Map<string, number>()
  points.forEach((p, i) => {
    const k = keyOf(p.e, p.n)
    if (!index.has(k)) index.set(k, i)
  })

  // layers that share a road: a spur layer's lines count as the same family as the layer they were split from
  const family = new Map<string, string>()
  for (const d of defs.values()) if (d.connect && d.spurLayer) family.set(d.spurLayer, d.layer)
  const fam = (layer: string) => family.get(layer) ?? layer

  // every point that belongs to a layer through a connecting code (a join may not skip over one)
  const layerPoints = new Map<string, number[]>()
  const exempt = new Set<string>()
  points.forEach((_, i) => {
    if (matches[i].offset) return
    const seen = new Set<string>()
    for (const code of matches[i].codes) {
      const d = defs.get(code)
      if (!d?.connect || seen.has(d.layer)) continue
      seen.add(d.layer)
      layerPoints.set(d.layer, [...(layerPoints.get(d.layer) ?? []), i])
      if (d.mayCross) exempt.add(fam(d.layer))
    }
  })
  // END stops the shot-order line, but it is only a hint about the shots: the drafter on the sample job drew straight through both of
  // its END points (178, 185), so a line that really does continue may still be bridged. BEG, CLO and per-code markers stay hard.
  const blocked = (i: number) => matches[i].begin || matches[i].close || Object.keys(matches[i].controls).length > 0

  // existing segments (for the crossing test), and which points are on a line already, by family
  const segs: Array<{ ax: number; ay: number; bx: number; by: number; layer: string }> = []
  const onLine = new Set<string>()
  const ends: End[] = []
  lines.forEach((l, li) => {
    const v = l.vertices
    for (let i = 1; i < v.length; i++) segs.push({ ax: v[i - 1].e, ay: v[i - 1].n, bx: v[i].e, by: v[i].n, layer: fam(l.layer) })
    if (l.closed && v.length > 2) segs.push({ ax: v[v.length - 1].e, ay: v[v.length - 1].n, bx: v[0].e, by: v[0].n, layer: fam(l.layer) })
    for (const x of v) {
      const i = index.get(keyOf(x.e, x.n))
      if (i !== undefined) onLine.add(`${fam(l.layer)}|${i}`)
    }
    if (l.closed || l.mayCross || v.length < 2) return
    for (const atStart of [true, false]) {
      const endIdx = atStart ? 0 : v.length - 1
      const pi = index.get(keyOf(v[endIdx].e, v[endIdx].n))
      if (pi === undefined || blocked(pi)) continue
      // heading: from the nearest earlier vertex that is far enough away to give a direction
      let h: [number, number] | null = null
      for (let k = 1; k < v.length && h === null; k++) {
        const o = v[atStart ? k : v.length - 1 - k]
        const dx = v[endIdx].e - o.e, dy = v[endIdx].n - o.n
        const len = Math.hypot(dx, dy)
        if (len >= HEADING_MIN_SEGMENT || k === v.length - 1) h = len > 0 ? [dx / len, dy / len] : null
      }
      if (h) ends.push({ layer: fam(l.layer), pt: pi, line: li, heading: h })
    }
  })
  // loose points: on a connecting layer, but on no line of that family
  for (const [layer, idxs] of layerPoints) {
    for (const i of idxs) if (!onLine.has(`${fam(layer)}|${i}`) && !blocked(i)) ends.push({ layer: fam(layer), pt: i, line: -1, heading: null })
  }

  /** Degrees between the way `from` was heading and the direction to `to` (0 for a loose point, which has no heading). */
  const off = (from: End, to: End): number => {
    if (!from.heading) return 0
    const dx = points[to.pt].e - points[from.pt].e, dy = points[to.pt].n - points[from.pt].n
    const len = Math.hypot(dx, dy)
    if (len === 0) return 180
    return (Math.acos(Math.max(-1, Math.min(1, (dx * from.heading[0] + dy * from.heading[1]) / len))) * 180) / Math.PI
  }
  interface Cand { a: End; b: End; d: number }
  const cands: Cand[] = []
  for (let x = 0; x < ends.length; x++) {
    for (let y = x + 1; y < ends.length; y++) {
      const a = ends[x], b = ends[y]
      if (a.layer !== b.layer || a.pt === b.pt) continue
      if (a.line === b.line && a.line !== -1) continue // would close the line on itself
      if (a.line === -1 && b.line === -1) continue // two loose points: that is gap filling's job, not a continuation
      const d = Math.hypot(points[a.pt].e - points[b.pt].e, points[a.pt].n - points[b.pt].n)
      if (d > longGap || d === 0) continue
      const dev = Math.max(off(a, b), off(b, a))
      if (dev > angle) continue
      if (d > gap && dev > STRAIGHT_ANGLE) continue // a long join needs the two lines pointing almost straight at each other
      cands.push({ a, b, d })
    }
  }
  cands.sort((p, q) => p.d - q.d)

  // Caps: the free ends of two lines that run side by side, both ending at the same place (the two edges of a driveway
  // stopping at the apron), are tied across by a short line square to both. Tried only for ends no continuation took.
  const capCos = Math.cos((CAP_ANGLE * Math.PI) / 180)
  const caps: Cand[] = []
  for (let x = 0; x < ends.length; x++) {
    for (let y = x + 1; y < ends.length; y++) {
      const a = ends[x], b = ends[y]
      if (a.layer !== b.layer || !a.heading || !b.heading || a.line === b.line) continue
      const dx = points[b.pt].e - points[a.pt].e, dy = points[b.pt].n - points[a.pt].n
      const d = Math.hypot(dx, dy)
      if (d < CAP_MIN_GAP || d > CAP_GAP) continue
      if (a.heading[0] * b.heading[0] + a.heading[1] * b.heading[1] < capCos) continue // not parallel and facing the same way
      if (Math.abs(dx * a.heading[0] + dy * a.heading[1]) / d > Math.sin((CAP_ANGLE * Math.PI) / 180)) continue // not square
      if (Math.abs(dx * b.heading[0] + dy * b.heading[1]) / d > Math.sin((CAP_ANGLE * Math.PI) / 180)) continue
      caps.push({ a, b, d })
    }
  }
  caps.sort((p, q) => p.d - q.d)
  cands.push(...caps)

  const skipsOver = (layer: string, i: number, j: number): boolean => {
    const ax = points[i].e, ay = points[i].n, dx = points[j].e - ax, dy = points[j].n - ay
    const len2 = dx * dx + dy * dy
    for (const [l, idxs] of layerPoints) {
      if (fam(l) !== layer) continue
      for (const k of idxs) {
        if (k === i || k === j) continue
        const t = ((points[k].e - ax) * dx + (points[k].n - ay) * dy) / len2
        if (t <= 0.02 || t >= 0.98) continue
        if (Math.hypot(points[k].e - (ax + t * dx), points[k].n - (ay + t * dy)) < 0.6) return true
      }
    }
    return false
  }

  const used = new Set<string>()
  const added: Polyline[] = []
  const joints = new Set<string>()
  // lines already tied together by a join made in this pass: a second join between them would close a loop
  const group = new Map<number, number>()
  const root = (x: number): number => {
    let r = x
    while ((group.get(r) ?? r) !== r) r = group.get(r)!
    return r
  }
  for (const c of cands) {
    if (c.a.line !== -1 && c.b.line !== -1 && root(c.a.line) === root(c.b.line)) continue
    const ka = `${c.a.layer}|${c.a.pt}`, kb = `${c.b.layer}|${c.b.pt}`
    if (used.has(ka) || used.has(kb)) continue
    if (skipsOver(c.a.layer, c.a.pt, c.b.pt)) continue
    const mine = { ax: points[c.a.pt].e, ay: points[c.a.pt].n, bx: points[c.b.pt].e, by: points[c.b.pt].n }
    if (!exempt.has(c.a.layer) && segs.some((s) => !exempt.has(s.layer) && properlyCross(mine, s))) continue
    used.add(ka)
    used.add(kb)
    if (c.a.line !== -1 && c.b.line !== -1) group.set(root(c.a.line), root(c.b.line))
    segs.push({ ...mine, layer: c.a.layer })
    const layer = lines[c.a.line]?.layer ?? lines[c.b.line]?.layer ?? c.a.layer
    joints.add(`${layer}|${keyOf(mine.ax, mine.ay)}`)
    joints.add(`${layer}|${keyOf(mine.bx, mine.by)}`)
    added.push({
      layer,
      key: 'gap-fill',
      closed: false,
      vertices: [
        { e: mine.ax, n: mine.ay, z: points[c.a.pt].z },
        { e: mine.bx, n: mine.by, z: points[c.b.pt].z },
      ],
    })
  }
  return added.length === 0 ? lines : mergeGapFills([...lines, ...added], joints)
}
