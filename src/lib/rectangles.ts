import type { CodeDef, PointMatch, Polyline, SurveyPoint } from './types.ts'

/** Points of one feature this close together (feet, chained point to point) belong to the same group. */
export const CLUSTER_FEET = 150
/** Every corner of the four points must be within this many degrees of a right angle. */
export const RIGHT_ANGLE_TOLERANCE = 10
/** Opposite sides must differ by no more than this share of the longer one. */
export const OPPOSITE_SIDE_TOLERANCE = 0.15
/** A side shorter than this (feet) is two shots of the same spot, not a corner. */
const MIN_SIDE_FEET = 3

const keyOf = (e: number, n: number) => `${e.toFixed(3)},${n.toFixed(3)}`

/**
 * The four points in order around their middle, if together they make a rectangle (or square): every corner a right angle within
 * the tolerance and opposite sides about equal. Null otherwise (a trapezoid, four points on a line, two close shots).
 */
export function asRectangle(four: SurveyPoint[]): SurveyPoint[] | null {
  if (four.length !== 4) return null
  const cx = four.reduce((t, p) => t + p.e, 0) / 4
  const cy = four.reduce((t, p) => t + p.n, 0) / 4
  const ring = [...four].sort((a, b) => Math.atan2(a.n - cy, a.e - cx) - Math.atan2(b.n - cy, b.e - cx))
  const side = (i: number) => {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    return { dx: b.e - a.e, dy: b.n - a.n, len: Math.hypot(b.e - a.e, b.n - a.n) }
  }
  const s = [0, 1, 2, 3].map(side)
  if (s.some((x) => x.len < MIN_SIDE_FEET)) return null
  for (let i = 0; i < 4; i++) {
    const a = s[i]
    const b = s[(i + 1) % 4]
    const cos = (a.dx * b.dx + a.dy * b.dy) / (a.len * b.len) // the turn between two sides: 0 at a right angle
    if (Math.abs((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI - 90) > RIGHT_ANGLE_TOLERANCE) return null
  }
  const close = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y) <= OPPOSITE_SIDE_TOLERANCE
  return close(s[0].len, s[2].len) && close(s[1].len, s[3].len) ? ring : null
}

/** Do two lists of corners go round the same shape: the same corners in the same order, from any start, either direction? */
function sameRing(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const n = a.length
  for (let start = 0; start < n; start++) {
    if ([...Array(n).keys()].every((i) => a[(start + i) % n] === b[i]) || [...Array(n).keys()].every((i) => a[(start - i + n) % n] === b[i])) return true
  }
  return false
}

/**
 * Four points that make a rectangle are a rectangle. Buildings, pads and decks are shot as four corners, often out of order, and the
 * drafter closes them into one four-sided shape. For each kind of feature, group its points that sit near each other; where a group is
 * exactly four points and they make a rectangle (or square), draw one closed four-sided line through them, whatever order they were
 * shot in. The points are not moved. A group whose points are also part of a longer line is left alone, and so is one already drawn
 * as exactly that rectangle.
 */
export function completeRectangles(points: SurveyPoint[], matches: PointMatch[], defs: Map<string, CodeDef>, lines: Polyline[]): Polyline[] {
  const index = new Map<string, number>()
  points.forEach((p, i) => {
    const k = keyOf(p.e, p.n)
    if (!index.has(k)) index.set(k, i)
  })

  // the points of each kind of feature (same layer and line key), by connecting code
  const groups = new Map<string, { layer: string; key: string; members: number[]; mayCross: boolean }>()
  points.forEach((_, i) => {
    if (matches[i].offset || matches[i].end || matches[i].begin || matches[i].close) return // an explicit BEG/END/CLO is the surveyor saying how to draw it
    const seen = new Set<string>()
    for (const code of matches[i].codes) {
      const d = defs.get(code)
      if (!d?.connect) continue
      const key = d.line ?? d.code
      const id = `${d.layer}|${key}`
      if (seen.has(id)) continue
      seen.add(id)
      const g = groups.get(id) ?? { layer: d.layer, key, members: [], mayCross: d.mayCross === true }
      g.members.push(i)
      groups.set(id, g)
    }
  })

  let out = lines
  for (const g of groups.values()) {
    if (g.members.length < 4) continue
    // single-linkage clusters
    const parent = g.members.map((_, i) => i)
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
    for (let a = 0; a < g.members.length; a++) {
      for (let b = a + 1; b < g.members.length; b++) {
        const pa = points[g.members[a]]
        const pb = points[g.members[b]]
        if (Math.hypot(pa.e - pb.e, pa.n - pb.n) <= CLUSTER_FEET) parent[find(a)] = find(b)
      }
    }
    const clusters = new Map<number, number[]>()
    g.members.forEach((m, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), m]))

    for (const cluster of clusters.values()) {
      if (cluster.length !== 4) continue
      const ring = asRectangle(cluster.map((i) => points[i]))
      if (!ring) continue
      const inCluster = new Set(cluster.map((i) => keyOf(points[i].e, points[i].n)))
      // lines of this layer that touch these points
      const touching = out.filter((l) => l.layer === g.layer && l.vertices.some((v) => inCluster.has(keyOf(v.e, v.n))))
      // part of a longer line: leave it alone
      if (touching.some((l) => l.vertices.some((v) => !inCluster.has(keyOf(v.e, v.n))))) continue
      // already drawn as exactly this rectangle: one closed line through the four corners in the rectangle's own order (a closed line in shot
      // order can cross itself, with sides running corner to corner, and must be redrawn)
      if (touching.length === 1 && touching[0].closed && touching[0].vertices.length === 4 && sameRing(touching[0].vertices.map((v) => keyOf(v.e, v.n)), ring.map((p) => keyOf(p.e, p.n)))) continue
      out = [
        ...out.filter((l) => !touching.includes(l)),
        { layer: g.layer, key: g.key, closed: true, vertices: ring.map((p) => ({ e: p.e, n: p.n, z: p.z })), ...(g.mayCross ? { mayCross: true } : {}) },
      ]
    }
  }
  return out
}
