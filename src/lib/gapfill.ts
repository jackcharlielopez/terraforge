import { dominantAxis, offAxis, properlyCross } from './geometry.ts'
import type { CodeDef, PointMatch, Polyline, SurveyPoint } from './types.ts'

/** A new line on a man-made layer may be this many degrees off the site's axes (leaves room for a rotated building). */
export const SQUARE_TOLERANCE = 12

/** Above this many candidate joins the step is skipped rather than risk freezing the page. */
const MAX_CANDIDATES = 50_000

const keyOf = (e: number, n: number) => `${e.toFixed(3)},${n.toFixed(3)}`

/**
 * Join leftover nearby points of the same layer ("colour") by position, shortest first. Shot order is the
 * strongest signal and has already been used; this only fills what it left open, so it never changes a line
 * that exists. A new join must: stay within `gap`; leave both points with at most two neighbours on that layer;
 * not close a loop; not cross any existing line (power, pipes and property lines excepted); and, on a layer of
 * man-made codes (`rectilinear`), run square to the site (the axis is estimated from the man-made lines already drawn).
 * New joins that meet an existing line are merged into it so the result is still a few long lines.
 */
export function fillGaps(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  lines: Polyline[],
  gap: number,
): Polyline[] {
  if (gap <= 0) return lines
  const index = new Map<string, number>()
  points.forEach((p, i) => {
    const k = keyOf(p.e, p.n)
    if (!index.has(k)) index.set(k, i)
  })

  // layer -> every point that belongs to it through a connecting code. A join may never skip over one of these.
  const groups = new Map<string, number[]>()
  const rectLayers = new Set<string>()
  const exemptLayers = new Set<string>()
  // layer|point -> may take part in a join (a shot carrying a begin/end/close marker is where the surveyor said a
  // line stops or starts: it is left alone, though it still blocks)
  const eligible = new Set<string>()
  points.forEach((_, i) => {
    const m = matches[i]
    if (m.offset) return
    const marked = m.begin || m.end || m.close || Object.keys(m.controls).length > 0
    const seen = new Set<string>()
    for (const code of m.codes) {
      const d = defs.get(code)
      if (!d?.connect) continue
      if (d.rectilinear) rectLayers.add(d.layer)
      if (d.mayCross) exemptLayers.add(d.layer)
      if (seen.has(d.layer)) continue
      seen.add(d.layer)
      groups.set(d.layer, [...(groups.get(d.layer) ?? []), i])
      if (!marked) eligible.add(`${d.layer}|${i}`)
    }
  })

  // existing segments, with each layer's per-point degree and loop-free components
  interface Seg { a: [number, number]; b: [number, number]; layer: string }
  const segs: Seg[] = []
  const deg = new Map<string, number>()
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!
    return r
  }
  const union = (x: string, y: string) => parent.set(find(x), find(y))
  const have = new Set<string>()
  const node = (layer: string, i: number) => `${layer}|${i}`
  const addEdge = (layer: string, i: number, j: number, a: [number, number], b: [number, number]) => {
    segs.push({ a, b, layer })
    for (const x of [i, j]) deg.set(node(layer, x), (deg.get(node(layer, x)) ?? 0) + 1)
    union(node(layer, i), node(layer, j))
    have.add(`${layer}|${Math.min(i, j)}|${Math.max(i, j)}`)
  }
  for (const l of lines) {
    const v = l.vertices
    const pairs: Array<[number, number]> = v.slice(1).map((_, i) => [i, i + 1])
    if (l.closed && v.length > 2) pairs.push([v.length - 1, 0])
    for (const [x, y] of pairs) {
      const i = index.get(keyOf(v[x].e, v[x].n))
      const j = index.get(keyOf(v[y].e, v[y].n))
      if (i === undefined || j === undefined) continue
      addEdge(l.layer, i, j, [v[x].e, v[x].n], [v[y].e, v[y].n])
    }
  }

  // the site's axes, from the man-made lines already drawn (null = too little to say, so no squareness test)
  const axis = dominantAxis(segs.filter((s) => rectLayers.has(s.layer)).map((s) => ({ ae: s.a[0], an: s.a[1], be: s.b[0], bn: s.b[1] })))

  // candidate joins, found through a grid so large jobs stay fast
  interface Cand { layer: string; i: number; j: number; d: number }
  const cands: Cand[] = []
  const cellOf = (x: number) => Math.floor(x / gap)
  const grids = new Map<string, Map<string, number[]>>()
  for (const [layer, idxs] of groups) {
    const cell = new Map<string, number[]>()
    for (const i of idxs) {
      const k = `${cellOf(points[i].e)},${cellOf(points[i].n)}`
      cell.set(k, [...(cell.get(k) ?? []), i])
    }
    grids.set(layer, cell)
    for (const i of idxs) {
      if (!eligible.has(`${layer}|${i}`)) continue
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of cell.get(`${cellOf(points[i].e) + dx},${cellOf(points[i].n) + dy}`) ?? []) {
            if (j <= i || !eligible.has(`${layer}|${j}`)) continue
            const d = Math.hypot(points[i].e - points[j].e, points[i].n - points[j].n)
            if (d > gap || d === 0) continue
            if (axis !== null && rectLayers.has(layer)) {
              const ang = (Math.atan2(points[j].n - points[i].n, points[j].e - points[i].e) * 180) / Math.PI
              if (offAxis(ang, axis) > SQUARE_TOLERANCE) continue
            }
            cands.push({ layer, i, j, d })
          }
        }
      }
    }
    if (cands.length > MAX_CANDIDATES) return lines
  }
  cands.sort((x, y) => x.d - y.d)

  /** A join must not run over another point of the layer: it should go to that point instead. */
  const skipsOver = (layer: string, i: number, j: number): boolean => {
    const cell = grids.get(layer)
    if (!cell) return false
    const ax = points[i].e, ay = points[i].n, bx = points[j].e, by = points[j].n
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    const x0 = cellOf(Math.min(ax, bx)) - 1, x1 = cellOf(Math.max(ax, bx)) + 1
    const y0 = cellOf(Math.min(ay, by)) - 1, y1 = cellOf(Math.max(ay, by)) + 1
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        for (const k of cell.get(`${cx},${cy}`) ?? []) {
          if (k === i || k === j) continue
          const t = ((points[k].e - ax) * dx + (points[k].n - ay) * dy) / len2
          if (t <= 0.02 || t >= 0.98) continue
          if (Math.hypot(points[k].e - (ax + t * dx), points[k].n - (ay + t * dy)) < 0.6) return true
        }
      }
    }
    return false
  }

  const added: Polyline[] = []
  for (const c of cands) {
    if ((deg.get(node(c.layer, c.i)) ?? 0) >= 2 || (deg.get(node(c.layer, c.j)) ?? 0) >= 2) continue
    if (find(node(c.layer, c.i)) === find(node(c.layer, c.j))) continue
    if (have.has(`${c.layer}|${c.i}|${c.j}`)) continue
    const a: [number, number] = [points[c.i].e, points[c.i].n]
    const b: [number, number] = [points[c.j].e, points[c.j].n]
    if (skipsOver(c.layer, c.i, c.j)) continue
    const mine = { ax: a[0], ay: a[1], bx: b[0], by: b[1] }
    if (!exemptLayers.has(c.layer) && segs.some((s) => !exemptLayers.has(s.layer) && properlyCross(mine, { ax: s.a[0], ay: s.a[1], bx: s.b[0], by: s.b[1] }))) continue
    addEdge(c.layer, c.i, c.j, a, b)
    added.push({
      layer: c.layer,
      key: 'gap-fill',
      closed: false,
      vertices: [
        { e: a[0], n: a[1], z: points[c.i].z },
        { e: b[0], n: b[1], z: points[c.j].z },
      ],
      ...(exemptLayers.has(c.layer) ? { mayCross: true } : {}),
    })
  }
  return added.length === 0 ? lines : mergeGapFills([...lines, ...added])
}

/**
 * Join a gap-fill line to whatever it meets end to end (same layer, exactly two line ends at that spot), so the
 * result is a few long lines. Lines that already met each other are left alone: a BEG marker must stay a break.
 * `joints` (`layer|e,n` keys) names spots where a join was just made, so the lines on either side merge whatever they are called.
 */
export function mergeGapFills(lines: Polyline[], joints?: ReadonlySet<string>): Polyline[] {
  const work = lines.map((l) => ({ ...l, vertices: [...l.vertices] }))
  const alive = work.map(() => true)
  for (;;) {
    const ends = new Map<string, Array<{ li: number; atStart: boolean }>>()
    work.forEach((l, li) => {
      if (!alive[li] || l.closed) return
      const first = l.vertices[0]
      const last = l.vertices[l.vertices.length - 1]
      for (const [v, atStart] of [[first, true], [last, false]] as const) {
        const k = `${l.layer}|${keyOf(v.e, v.n)}`
        ends.set(k, [...(ends.get(k) ?? []), { li, atStart }])
      }
    })
    let merged = false
    for (const list of ends.values()) {
      if (list.length !== 2 || list[0].li === list[1].li) continue
      const [x, y] = list
      const k = [...ends.entries()].find(([, v]) => v === list)![0]
      if (!joints?.has(k) && work[x.li].key !== 'gap-fill' && work[y.li].key !== 'gap-fill') continue
      const a = work[x.li]
      const b = work[y.li]
      const av = x.atStart ? [...a.vertices].reverse() : a.vertices // ends where they meet
      const bv = y.atStart ? b.vertices : [...b.vertices].reverse() // starts where they meet
      a.vertices = [...av, ...bv.slice(1)]
      if (a.key === 'gap-fill') a.key = b.key
      if (b.mayCross) a.mayCross = true
      alive[y.li] = false
      merged = true
      break
    }
    if (!merged) break
  }
  return work.filter((_, i) => alive[i])
}

/** Below this orderliness the numbering carries no usable information about which shots belong together. */
export const SCRAMBLED_BELOW = 0.5

/**
 * How much the point numbering can be trusted: the share of connecting points whose nearest same-layer neighbour
 * (by position, within `gap`) is also within two places of them in the numbering of that layer's shots. Measured on
 * the sample job it is 0.81 in order and 0.78 to 0.81 with 20-40% of neighbours swapped, but 0.18 when the numbers
 * are scrambled, so it cleanly flags the case where shot order is meaningless. Returns 1 when there is nothing to judge.
 */
export function orderliness(points: SurveyPoint[], matches: PointMatch[], defs: Map<string, CodeDef>, gap = 60): number {
  const order = points.map((_, i) => i).sort((a, b) => compareNoLocal(points[a].no, points[b].no) || a - b)
  const rank = new Map(order.map((i, r) => [i, r]))
  const layers = new Map<string, number[]>()
  points.forEach((_, i) => {
    if (matches[i].offset) return
    const seen = new Set<string>()
    for (const code of matches[i].codes) {
      const d = defs.get(code)
      if (!d?.connect || seen.has(d.layer)) continue
      seen.add(d.layer)
      layers.set(d.layer, [...(layers.get(d.layer) ?? []), i])
    }
  })
  let n = 0
  let good = 0
  for (const idxs of layers.values()) {
    if (idxs.length > 2000) continue // quadratic below; very large layers are skipped rather than slow the page
    const byRank = [...idxs].sort((a, b) => rank.get(a)! - rank.get(b)!)
    const within = new Map(byRank.map((i, r) => [i, r]))
    for (const i of idxs) {
      let best = -1
      let bestD = gap
      for (const j of idxs) {
        if (j === i) continue
        const d = Math.hypot(points[i].e - points[j].e, points[i].n - points[j].n)
        if (d < bestD) {
          bestD = d
          best = j
        }
      }
      if (best === -1) continue
      n++
      if (Math.abs(within.get(i)! - within.get(best)!) <= 2) good++
    }
  }
  return n === 0 ? 1 : good / n
}

function compareNoLocal(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return a.localeCompare(b, undefined, { numeric: true })
}
