import { SQUARE_TOLERANCE } from './gapfill.ts'
import { dominantAxis, offAxis, rebuildWithout } from './geometry.ts'
import type { CodeDef, PointMatch, Polyline, SurveyPoint } from './types.ts'

const DEFAULT_SPUR_ANGLE = 35
/** An axis is only trusted when the points spread at least this much more along it than across it. */
const MIN_ELONGATION = 2

const offAxis180 = (angleDeg: number, axisDeg: number) => {
  const d = Math.abs((((angleDeg - axisDeg) % 180) + 180) % 180)
  return Math.min(d, 180 - d)
}

/**
 * A road edge and a driveway off it share the same codes (EP, FOC...), but the drafter draws them on different layers: the
 * road edge runs along the road, the driveway runs away from it. The road's direction is the long axis of all the points of that
 * line (shots run far along the road but only a little across a driveway), never taken from the lines themselves, which
 * a driveway can dominate. Segments more than `spurAngle` degrees off that axis move to the code's `spurLayer`.
 */
export function reassignSpurs(points: SurveyPoint[], matches: PointMatch[], defs: Map<string, CodeDef>, lines: Polyline[]): Polyline[] {
  const spurDefs = new Map<string, CodeDef>() // line key -> a def carrying the spur settings
  for (const d of defs.values()) if (d.connect && d.spurLayer) spurDefs.set(d.line ?? d.code, d)
  if (spurDefs.size === 0) return lines

  const out: Polyline[] = []
  const handled = new Set<number>()
  for (const [groupKey, def] of spurDefs) {
    const axis = principalAxis(points, matches, defs, groupKey)
    if (axis === null) continue
    const tol = def.spurAngle ?? DEFAULT_SPUR_ANGLE
    const corners = cornerPoints(points, matches, defs, groupKey)
    lines.forEach((l, li) => {
      if (handled.has(li) || l.layer !== def.layer || !(l.key === groupKey || l.key.startsWith(groupKey + '#'))) return
      handled.add(li)
      if (l.closed) return void out.push(l) // a closed shape is deliberate: never re-split it
      const v = l.vertices
      // classify each segment, then rebuild runs of the same class
      const isSpur = v.slice(1).map((b, i) => offAxis180((Math.atan2(b.n - v[i].n, b.e - v[i].e) * 180) / Math.PI, axis) > tol)
      if (isSpur.every((x) => !x)) return void out.push(l)
      let run = [v[0]]
      let cur = isSpur[0]
      let startsAtJunction = false
      const flush = (endsAtJunction: boolean) => {
        // A driveway edge starts after the mouth corner, not at it: where a road-aligned run meets a spur at a multi-code
        // corner (EP/BOC), that corner belongs to the road edge.
        if (cur) {
          if (startsAtJunction && run.length >= 2 && corners.has(posKey(run[0]))) run = run.slice(1)
          if (endsAtJunction && run.length >= 2 && corners.has(posKey(run[run.length - 1]))) run = run.slice(0, -1)
        }
        // two shots a few feet apart across the kerb (face of curb and gutter) are not a driveway edge
        if (cur && run.length === 2 && Math.hypot(run[1].e - run[0].e, run[1].n - run[0].n) < SPUR_MIN_LENGTH) return
        // one segment leaving a mouth corner is too little to call a driveway edge: the corner stays on the road edge
        if (cur && run.length === 2 && (corners.has(posKey(run[0])) || corners.has(posKey(run[1])))) return
        if (run.length >= 2) out.push({ ...l, layer: cur ? def.spurLayer! : l.layer, key: cur ? l.key + '-spur' : l.key, vertices: run, closed: false })
      }
      for (let i = 1; i < v.length; i++) {
        if (isSpur[i - 1] !== cur) {
          flush(true)
          run = [v[i - 1]]
          cur = isSpur[i - 1]
          startsAtJunction = true
        }
        run.push(v[i])
      }
      flush(false)
    })
  }
  return [...lines.filter((_, li) => !handled.has(li)), ...out]
}

/** A spur run of one segment shorter than this many feet is dropped. */
const SPUR_MIN_LENGTH = 3

const posKey = (v: { e: number; n: number }) => `${v.e.toFixed(3)},${v.n.toFixed(3)}`

/**
 * Corner points: shots that carry two or more codes of the same line group (EP/BOC at a driveway mouth: the pavement edge and the
 * back of the curb meet there). They sit on the road edge itself, so a spur never starts from one.
 */
function cornerPoints(points: SurveyPoint[], matches: PointMatch[], defs: Map<string, CodeDef>, groupKey: string): Set<string> {
  const out = new Set<string>()
  points.forEach((p, i) => {
    if (matches[i].offset) return
    const n = matches[i].codes.filter((c) => (defs.get(c)?.line ?? defs.get(c)?.code) === groupKey).length
    if (n >= 2) out.add(posKey(p))
  })
  return out
}

/** Long axis (degrees from east, 0..180) of the points that belong to a line key, or null when there is no clear one. */
function principalAxis(points: SurveyPoint[], matches: PointMatch[], defs: Map<string, CodeDef>, groupKey: string): number | null {
  const pts: Array<[number, number]> = []
  points.forEach((p, i) => {
    if (matches[i].offset) return
    if (matches[i].codes.some((c) => (defs.get(c)?.line ?? defs.get(c)?.code) === groupKey)) pts.push([p.e, p.n])
  })
  if (pts.length < 4) return null
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  const tr = sxx + syy
  const det = sxx * syy - sxy * sxy
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + disc
  const l2 = Math.max(tr / 2 - disc, 1e-9)
  if (Math.sqrt(l1 / l2) < MIN_ELONGATION) return null
  return ((0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI + 180) % 180
}

/**
 * The same segment can be drawn on two layers when a point carries two codes (CONC/FOC/EP is sidewalk and road edge at once).
 * The layer whose codes have the higher `priority` keeps it; equal priority keeps both, as before. On the sample job the
 * drafter put 3 of the 4 such segments on the sidewalk layer, hence the starter's priority for CONC.
 */
export function resolveLayerDuplicates(defs: Map<string, CodeDef>, lines: Polyline[]): Polyline[] {
  const prio = new Map<string, number>()
  for (const d of defs.values()) prio.set(d.layer, Math.max(prio.get(d.layer) ?? -Infinity, d.priority ?? 0))
  const key = (a: { e: number; n: number }, b: { e: number; n: number }) => {
    const x = `${a.e.toFixed(3)},${a.n.toFixed(3)}`
    const y = `${b.e.toFixed(3)},${b.n.toFixed(3)}`
    return x < y ? `${x}|${y}` : `${y}|${x}`
  }
  const layersOf = new Map<string, Set<string>>()
  for (const l of lines) {
    const v = l.vertices
    const n = l.closed && v.length > 2 ? v.length : v.length - 1
    for (let i = 0; i < n; i++) {
      const k = key(v[i], v[(i + 1) % v.length])
      layersOf.set(k, (layersOf.get(k) ?? new Set()).add(l.layer))
    }
  }
  const dropBy = new Map<number, Set<number>>()
  lines.forEach((l, li) => {
    if (l.mayCross) return
    const v = l.vertices
    const n = l.closed && v.length > 2 ? v.length : v.length - 1
    for (let i = 0; i < n; i++) {
      const layers = layersOf.get(key(v[i], v[(i + 1) % v.length]))
      if (!layers || layers.size < 2) continue
      const best = Math.max(...[...layers].map((x) => prio.get(x) ?? 0))
      if ((prio.get(l.layer) ?? 0) < best) dropBy.set(li, (dropBy.get(li) ?? new Set()).add(i))
    }
  })
  return dropBy.size === 0 ? lines : rebuildWithout(lines, dropBy)
}

/** A short skewed segment is judged only between these lengths (feet): shorter ones have a noisy direction, longer ones can be a real diagonal. */
const STUB_MIN = 2
const STUB_MAX = 10

/**
 * On layers of man-made codes (`rectilinear`: sidewalks, curbs, walls) a short segment that is not square to the rest of the
 * site is a cluster of nearby shots, not a wall. On the sample job every skewed sidewalk segment of 2 ft or more was wrong and every
 * right skewed one was under 2 ft (survey noise), and dropping them lost no correct line. The site's direction is estimated from
 * the man-made lines themselves; with too few of them nothing is dropped. Long diagonals (a real angled path) and closed shapes are kept.
 */
export function removeSkewedStubs(defs: Map<string, CodeDef>, lines: Polyline[]): Polyline[] {
  const rect = new Set<string>()
  for (const d of defs.values()) if (d.connect && d.rectilinear) rect.add(d.layer)
  if (rect.size === 0) return lines

  interface S { li: number; i: number; ae: number; an: number; be: number; bn: number }
  const segs: S[] = []
  lines.forEach((l, li) => {
    if (!rect.has(l.layer) || l.closed) return
    const v = l.vertices
    for (let i = 1; i < v.length; i++) segs.push({ li, i: i - 1, ae: v[i - 1].e, an: v[i - 1].n, be: v[i].e, bn: v[i].n })
  })
  const axis = dominantAxis(segs)
  if (axis === null) return lines

  const dropBy = new Map<number, Set<number>>()
  for (const s of segs) {
    const len = Math.hypot(s.be - s.ae, s.bn - s.an)
    if (len < STUB_MIN || len > STUB_MAX) continue
    const ang = (Math.atan2(s.bn - s.an, s.be - s.ae) * 180) / Math.PI
    if (offAxis(ang, axis) > SQUARE_TOLERANCE) dropBy.set(s.li, (dropBy.get(s.li) ?? new Set()).add(s.i))
  }
  return dropBy.size === 0 ? lines : rebuildWithout(lines, dropBy)
}
