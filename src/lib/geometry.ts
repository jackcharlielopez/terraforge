import type { Polyline } from './types.ts'

/**
 * Count places where drawn lines cross each other, a quick measure of "criss-crossing".
 * Counts proper crossings between segments on any layers (touching at a shared end point or running
 * along each other does not count). Lines flagged `mayCross` (overhead power, pipes, property lines)
 * are left out, since those legitimately cross other things.
 */
/** Above this many segments the pairwise check is skipped (it is quadratic). */
const MAX_SEGMENTS = 4000

export function countCrossings(lines: Polyline[]): number | null {
  interface Seg {
    ax: number; ay: number; bx: number; by: number
    layer: string
  }
  const segs: Seg[] = []
  for (const l of lines) {
    if (l.mayCross) continue
    const v = l.vertices
    for (let i = 1; i < v.length; i++) segs.push({ ax: v[i - 1].e, ay: v[i - 1].n, bx: v[i].e, by: v[i].n, layer: l.layer })
    if (l.closed && v.length > 2) segs.push({ ax: v[v.length - 1].e, ay: v[v.length - 1].n, bx: v[0].e, by: v[0].n, layer: l.layer })
  }
  if (segs.length > MAX_SEGMENTS) return null
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (properlyCross(segs[i], segs[j])) n++
    }
  }
  return n
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** True when the two segments cross at a point interior to both (shared end points do not count). */
export function properlyCross(s: { ax: number; ay: number; bx: number; by: number }, t: { ax: number; ay: number; bx: number; by: number }): boolean {
  const shares = (x: number, y: number) => (x === t.ax && y === t.ay) || (x === t.bx && y === t.by)
  if (shares(s.ax, s.ay) || shares(s.bx, s.by)) return false
  const d1 = orient(t.ax, t.ay, t.bx, t.by, s.ax, s.ay)
  const d2 = orient(t.ax, t.ay, t.bx, t.by, s.bx, s.by)
  const d3 = orient(s.ax, s.ay, s.bx, s.by, t.ax, t.ay)
  const d4 = orient(s.ax, s.ay, s.bx, s.by, t.bx, t.by)
  return d1 * d2 < 0 && d3 * d4 < 0
}

interface Seg {
  line: number
  idx: number
  a: { e: number; n: number; z: number }
  b: { e: number; n: number; z: number }
  len: number
}

/**
 * Lines of surface features (curb, ditch, walk, drive...) should not cross each other. When the
 * connection rules produce a crossing, drop the segments that cause it: repeatedly remove the segment
 * involved in the most crossings (the longer one on a tie, since a long jump is the likelier mistake)
 * until none cross, then re-assemble what is left into lines. Lines flagged `mayCross` (overhead power,
 * pipes, property lines) neither cause nor suffer removal. Crossings are checked across all layers.
 */
export function removeCrossings(lines: Polyline[]): { lines: Polyline[]; removed: number } {
  const segs: Seg[] = []
  lines.forEach((l, li) => {
    if (l.mayCross) return
    const v = l.vertices
    for (let i = 1; i < v.length; i++) segs.push({ line: li, idx: i - 1, a: v[i - 1], b: v[i], len: Math.hypot(v[i].e - v[i - 1].e, v[i].n - v[i - 1].n) })
    if (l.closed && v.length > 2) segs.push({ line: li, idx: v.length - 1, a: v[v.length - 1], b: v[0], len: Math.hypot(v[0].e - v[v.length - 1].e, v[0].n - v[v.length - 1].n) })
  })
  if (segs.length > MAX_SEGMENTS) return { lines, removed: 0 }

  const hits = segs.map(() => new Set<number>())
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j]
      if (properlyCross({ ax: s.a.e, ay: s.a.n, bx: s.b.e, by: s.b.n }, { ax: t.a.e, ay: t.a.n, bx: t.b.e, by: t.b.n })) {
        hits[i].add(j)
        hits[j].add(i)
      }
    }
  }

  const dropped = new Set<number>()
  for (;;) {
    let worst = -1
    for (let i = 0; i < segs.length; i++) {
      if (dropped.has(i) || hits[i].size === 0) continue
      if (worst === -1 || hits[i].size > hits[worst].size || (hits[i].size === hits[worst].size && segs[i].len > segs[worst].len)) worst = i
    }
    if (worst === -1) break
    dropped.add(worst)
    for (const j of hits[worst]) hits[j].delete(worst)
    hits[worst].clear()
  }
  if (dropped.size === 0) return { lines, removed: 0 }

  const dropBy = new Map<number, Set<number>>()
  for (const i of dropped) {
    const set = dropBy.get(segs[i].line) ?? new Set<number>()
    set.add(segs[i].idx)
    dropBy.set(segs[i].line, set)
  }
  return { lines: rebuildWithout(lines, dropBy), removed: dropped.size }
}

/**
 * Re-assemble lines after some segments were taken out: `dropBy` maps a line index to the indexes of its segments to
 * remove (a closed line's closing segment has the index of its last vertex). Each surviving run becomes its own line.
 */
export function rebuildWithout(lines: Polyline[], dropBy: Map<number, Set<number>>): Polyline[] {
  const out: Polyline[] = []
  lines.forEach((l, li) => {
    const gone = dropBy.get(li)
    if (!gone) return void out.push(l)
    const v = l.vertices
    const total = l.closed && v.length > 2 ? v.length : v.length - 1 // segment count, incl. the closing one
    let run: typeof v = []
    const flush = () => {
      if (run.length >= 2) out.push({ ...l, vertices: run, closed: false })
      run = []
    }
    for (let i = 0; i < total; i++) {
      if (gone.has(i)) {
        flush()
        continue
      }
      if (run.length === 0) run.push(v[i])
      run.push(v[(i + 1) % v.length])
    }
    flush()
  })
  return out
}

/** Longest line the zig-zag repair will search (it tries every reversal of a stretch of the line). */
const REPAIR_MAX_VERTICES = 60

/**
 * Sharp turns and total length of an open path, judging a turn only where both segments are at least `minSegment` long.
 */
function pathShape(v: Array<{ e: number; n: number }>, minAngle: number, minSegment: number): { sharp: number; length: number } {
  let sharp = 0
  let length = 0
  for (let i = 1; i < v.length; i++) length += Math.hypot(v[i].e - v[i - 1].e, v[i].n - v[i - 1].n)
  for (let i = 1; i < v.length - 1; i++) {
    const ux = v[i - 1].e - v[i].e, uy = v[i - 1].n - v[i].n, wx = v[i + 1].e - v[i].e, wy = v[i + 1].n - v[i].n
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy)
    if (lu < minSegment || lw < minSegment) continue
    const cos = (ux * wx + uy * wy) / (lu * lw)
    if ((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI < minAngle) sharp++
  }
  return { sharp, length }
}

/** True when two segments of the same path properly cross (a repaired order must not tie itself in a knot). */
function selfCrosses(v: Array<{ e: number; n: number }>): boolean {
  for (let i = 0; i < v.length - 1; i++) {
    for (let j = i + 2; j < v.length - 1; j++) {
      if (properlyCross({ ax: v[i].e, ay: v[i].n, bx: v[i + 1].e, by: v[i + 1].n }, { ax: v[j].e, ay: v[j].n, bx: v[j + 1].e, by: v[j + 1].n })) return true
    }
  }
  return false
}

/**
 * A crew often zig-zags (shoots 243, 245, 246, then 249 back beyond 243) and shot order then makes a line fold back on itself.
 * Before the sharp-turn rule deletes a segment, try putting the stretch in a better order: reverse a run of vertices inside the
 * line (its two ends stay where the surveyor put them) when that removes sharp turns, makes the line shorter and does not
 * make it cross itself. Repeats while it helps. Lines flagged `mayCross` and closed lines are left alone.
 */
export function repairZigzags(lines: Polyline[], minAngle: number, minSegment = MIN_TURN_SEGMENT): { lines: Polyline[]; repaired: number } {
  let repaired = 0
  const out = lines.map((l) => {
    if (l.closed || l.mayCross || l.vertices.length < 4 || l.vertices.length > REPAIR_MAX_VERTICES) return l
    let v = l.vertices
    let shape = pathShape(v, minAngle, minSegment)
    for (let guard = 0; guard < v.length && shape.sharp > 0; guard++) {
      let best: { v: typeof v; shape: typeof shape } | null = null
      for (let i = 1; i < v.length - 2; i++) {
        for (let j = i + 1; j <= v.length - 2; j++) {
          const cand = [...v.slice(0, i), ...v.slice(i, j + 1).reverse(), ...v.slice(j + 1)]
          const s = pathShape(cand, minAngle, minSegment)
          if (s.sharp >= shape.sharp || s.length >= shape.length) continue
          if (best && (s.sharp > best.shape.sharp || (s.sharp === best.shape.sharp && s.length >= best.shape.length))) continue
          if (selfCrosses(cand)) continue
          best = { v: cand, shape: s }
        }
      }
      if (!best) break
      v = best.v
      shape = best.shape
      repaired++
    }
    return v === l.vertices ? l : { ...l, vertices: v }
  })
  return { lines: repaired === 0 ? lines : out, repaired }
}

/** A turn is only judged when both segments are at least this long (feet): shorter ones give an unreliable direction. */
const MIN_TURN_SEGMENT = 2

/**
 * Lines should not double back on themselves. Wherever exactly two segments meet at a sharp angle (under `minAngle`
 * degrees, 180 being straight on), drop the longer of the two: a long jump is the likelier mistake. Measured on the sample
 * job, the drafter's lines have one such turn in 162 junctions (94 are square corners, 60 straight), ours had 7 in 77, and
 * dropping the longer segment removed only wrong lines. Lines flagged `mayCross` (power, pipes, property) are left alone.
 */
export function removeHairpins(input: Polyline[], minAngle: number, minSegment = MIN_TURN_SEGMENT, repair = true): { lines: Polyline[]; removed: number; repaired: number } {
  if (minAngle <= 0) return { lines: input, removed: 0, repaired: 0 }
  const fixed = repair ? repairZigzags(input, minAngle, minSegment) : { lines: input, repaired: 0 }
  const lines = fixed.lines
  const repaired = fixed.repaired
  const key = (e: number, n: number) => `${e.toFixed(3)},${n.toFixed(3)}`
  interface End { line: number; idx: number; here: { e: number; n: number }; other: { e: number; n: number }; len: number }
  const ends = new Map<string, End[]>()
  lines.forEach((l, li) => {
    if (l.mayCross) return
    const v = l.vertices
    const count = l.closed && v.length > 2 ? v.length : v.length - 1
    for (let i = 0; i < count; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const len = Math.hypot(b.e - a.e, b.n - a.n)
      if (len < 0.001) continue
      for (const [here, other] of [[a, b], [b, a]] as const) {
        const k = key(here.e, here.n)
        ends.set(k, [...(ends.get(k) ?? []), { line: li, idx: i, here, other, len }])
      }
    }
  })
  const dropBy = new Map<number, Set<number>>()
  let removed = 0
  for (const arr of ends.values()) {
    if (arr.length !== 2) continue
    const [x, y] = arr
    const ux = x.other.e - x.here.e, uy = x.other.n - x.here.n, wx = y.other.e - y.here.e, wy = y.other.n - y.here.n
    const cos = (ux * wx + uy * wy) / (x.len * y.len)
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    if (angle >= minAngle) continue
    // a direction measured on a very short segment is mostly survey noise (about 0.1 ft either way): do not judge it
    if (Math.min(x.len, y.len) < minSegment) continue
    const victim = x.len >= y.len ? x : y
    const set = dropBy.get(victim.line) ?? new Set<number>()
    if (!set.has(victim.idx)) {
      set.add(victim.idx)
      dropBy.set(victim.line, set)
      removed++
    }
  }
  return removed === 0 ? { lines, removed: 0, repaired } : { lines: rebuildWithout(lines, dropBy), removed, repaired }
}

/**
 * The dominant direction of a set of segments, in degrees from east: a length-weighted circular mean of four times
 * each angle, so a wall and the wall square to it vote for the same axis. null when there is too little to decide.
 */
export function dominantAxis(segs: Array<{ ae: number; an: number; be: number; bn: number }>): number | null {
  let sx = 0
  let sy = 0
  let n = 0
  for (const s of segs) {
    const len = Math.hypot(s.be - s.ae, s.bn - s.an)
    if (len <= 3) continue
    const t = 4 * Math.atan2(s.bn - s.an, s.be - s.ae)
    sx += len * Math.cos(t)
    sy += len * Math.sin(t)
    n++
  }
  return n < 3 ? null : (Math.atan2(sy, sx) / 4) * (180 / Math.PI)
}

/** How many degrees a direction is from the nearest of the two axes (the axis and the one square to it): 0..45. */
export function offAxis(angleDeg: number, axisDeg: number): number {
  const d = Math.abs((((angleDeg - axisDeg) % 90) + 90) % 90)
  return Math.min(d, 90 - d)
}
