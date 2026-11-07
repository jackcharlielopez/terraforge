import type { Vertex } from './traverse.ts'

export interface Anchor {
  no: string
  e: number
  n: number
}

export interface Placement {
  /** Degrees the deed's bearings were turned to meet the grid (old deeds use an older meridian). */
  rotation: number
  /** The corners in the drawing's coordinates, in the order of the deed. */
  vertices: Vertex[]
  /** Found pins and monuments that lie on the outline; `corner` is set when the pin is at a corner. */
  hits: Array<{ anchor: string; distance: number; corner: number | null }>
}

/** A pin within this many feet of the outline counts as lying on it (old deeds are good to a few feet). */
export const HIT_FEET = 5
/** At least this many pins must lie on the outline before it is placed: two can always be matched by turning it. */
export const MIN_HITS = 3
/** The pins on the outline must not all lie on one line: the shape could then slide along it. One must be at least this far off the line through the two farthest apart. */
const MIN_SPREAD = 10
/** The deed's bearings are searched over this many degrees either way. */
const MAX_ROTATION = 15
const MAX_CORNERS = 80
const MAX_ANCHORS = 25
/**
 * In scoring, a pin farther than this from the outline counts as exactly this far: pins that belong to a neighbour (or to a lot cut from
 * this tract) say nothing about where it sits, so they must not pull the fit toward them.
 */
const SCORE_CAP = 10
/** A pin on a corner (within this many feet) is worth this much more than one along a line: a corner fixes the length and bearing of two sides. */
const CORNER_FEET = 2
const CORNER_BONUS = 5
/** Feet of score per degree turned (a tie-breaker only). Between two placements that explain the pins equally well, the smaller turn wins (deeds are rarely far off the grid). */
const TURN_PENALTY = 0.5

const turn = (v: Vertex[], degrees: number): Vertex[] => {
  const c = Math.cos((degrees * Math.PI) / 180)
  const s = Math.sin((degrees * Math.PI) / 180)
  return v.map((p) => ({ e: p.e * c + p.n * s, n: -p.e * s + p.n * c }))
}

/** Distance from a point to the closed outline through `corners` shifted by (dx, dy). */
const distanceToOutline = (px: number, py: number, corners: Vertex[], dx: number, dy: number): number => {
  let best = Infinity
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    const ax = a.e + dx
    const ay = a.n + dy
    const vx = b.e - a.e
    const vy = b.n - a.n
    const len2 = vx * vx + vy * vy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2))
    best = Math.min(best, Math.hypot(px - (ax + t * vx), py - (ay + t * vy)))
  }
  return best
}

/**
 * The score of an outline (turned already) slid by (dx, dy): how far each pin is from it, capped, with a reward for a pin on a corner. The
 * inner loop of the search, so it works on plain arrays and does not allocate.
 */
function scoreShape(se: Float64Array, sn: Float64Array, pe: Float64Array, pn: Float64Array, dx: number, dy: number): number {
  const n = se.length
  let score = 0
  for (let k = 0; k < pe.length; k++) {
    const px = pe[k] - dx
    const py = pn[k] - dy
    let best = Infinity
    let corner = false
    for (let i = 0; i < n; i++) {
      const ax = se[i]
      const ay = sn[i]
      const j = i + 1 === n ? 0 : i + 1
      const vx = se[j] - ax
      const vy = sn[j] - ay
      const wx = px - ax
      const wy = py - ay
      if (wx * wx + wy * wy <= CORNER_FEET * CORNER_FEET) corner = true
      const len2 = vx * vx + vy * vy
      let u = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2
      u = u < 0 ? 0 : u > 1 ? 1 : u
      const ex = wx - u * vx
      const ey = wy - u * vy
      const d2 = ex * ex + ey * ey
      if (d2 < best) best = d2
    }
    score += Math.min(Math.sqrt(best), SCORE_CAP) - (corner ? CORNER_BONUS : 0)
  }
  return score
}

/** The most work (corner x pin comparisons) the search may do before it gives up, so a huge parcel on a job with many pins cannot freeze the page. */
const WORK_LIMIT = 5e7
/** The first pass tries turns this far apart; a valley where several pins fit at once is only a few hundredths of a degree wide, so the best few candidates (not just the best) are refined. */
const COARSE_STEP = 0.25
const FINE_STEP = 0.02
const REFINE_TOP = 6
/** Candidates this close in turn count as the same valley. */
const SAME_VALLEY = 0.6

/** True when the pins are not all on one line. */
function spread(p: Anchor[]): boolean {
  let far: [Anchor, Anchor] | null = null
  let longest = -1
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const d = Math.hypot(p[i].e - p[j].e, p[i].n - p[j].n)
      if (d > longest) {
        longest = d
        far = [p[i], p[j]]
      }
    }
  }
  if (!far || longest === 0) return false
  const [a, b] = far
  return p.some((c) => Math.abs((b.e - a.e) * (a.n - c.n) - (a.e - c.e) * (b.n - a.n)) / longest >= MIN_SPREAD)
}

/** True when the outline has so many corners, and the job so many pins, that the search would take too long: it is then not attempted. */
export function tooBigToFit(corners: Vertex[], anchors: Anchor[]): boolean {
  const P = Math.min(anchors.length, MAX_ANCHORS)
  const rotations = Math.floor((2 * MAX_ROTATION) / COARSE_STEP) + 1
  return corners.length * corners.length * P * P * rotations > WORK_LIMIT
}

/**
 * Place a computed outline on the drawing using the pins found in the field. The deed gives the shape; the pins give where it is and
 * which way it points: turn it a little (old bearings) and slide it so that as many found pins as possible lie on its lines. At least
 * three must, and not all on one line. Returns null when that cannot be shown.
 */
export function fitOutline(corners: Vertex[], anchors: Anchor[]): Placement | null {
  if (corners.length < 3 || corners.length > MAX_CORNERS || anchors.length < MIN_HITS) return null
  if (tooBigToFit(corners, anchors)) return null
  const pins = anchors.slice(0, MAX_ANCHORS)
  const V = corners.length
  const P = pins.length
  const pe = Float64Array.from(pins, (p) => p.e)
  const pn = Float64Array.from(pins, (p) => p.n)

  // Every way to put a corner on a pin, at each trial turn: keep the best-scoring one.
  const trial = (rotation: number) => {
    const shape = turn(corners, rotation)
    const se = Float64Array.from(shape, (p) => p.e)
    const sn = Float64Array.from(shape, (p) => p.n)
    let best: { score: number; dx: number; dy: number; corner: number; pin: number } | null = null
    for (let c = 0; c < V; c++) {
      for (let a = 0; a < P; a++) {
        const dx = pe[a] - se[c]
        const dy = pn[a] - sn[c]
        const score = scoreShape(se, sn, pe, pn, dx, dy) + TURN_PENALTY * Math.abs(rotation)
        if (!best || score < best.score) best = { score, dx, dy, corner: c, pin: a }
      }
    }
    return best ? { ...best, rotation, shape } : null
  }

  // First pass: every turn, with the best corner-on-pin arrangement at each.
  const coarse: Array<NonNullable<ReturnType<typeof trial>>> = []
  for (let r = -MAX_ROTATION; r <= MAX_ROTATION + 1e-9; r += COARSE_STEP) {
    const t = trial(r)
    if (t) coarse.push(t)
  }
  if (coarse.length === 0) return null
  coarse.sort((a, b) => a.score - b.score)
  // Second pass: refine the turn around the best candidates, each with its corner kept on its pin. Candidates in the same valley count once.
  const starts: typeof coarse = []
  for (const c of coarse) {
    if (starts.length >= REFINE_TOP) break
    if (starts.every((s) => Math.abs(s.rotation - c.rotation) > SAME_VALLEY)) starts.push(c)
  }
  let best = coarse[0]
  for (const start of starts) {
    for (let r = start.rotation - COARSE_STEP; r <= start.rotation + COARSE_STEP + 1e-9; r += FINE_STEP) {
      const shape = turn(corners, r)
      const se = Float64Array.from(shape, (p) => p.e)
      const sn = Float64Array.from(shape, (p) => p.n)
      const dx = pe[start.pin] - se[start.corner]
      const dy = pn[start.pin] - sn[start.corner]
      const score = scoreShape(se, sn, pe, pn, dx, dy) + TURN_PENALTY * Math.abs(r)
      if (score < best.score) best = { score, dx, dy, corner: start.corner, pin: start.pin, rotation: r, shape }
    }
  }

  const vertices = best.shape.map((p) => ({ e: p.e + best.dx, n: p.n + best.dy }))
  const hits: Placement['hits'] = []
  for (const a of pins) {
    const distance = distanceToOutline(a.e, a.n, vertices, 0, 0)
    if (distance > HIT_FEET) continue
    const atCorner = vertices.findIndex((v) => Math.hypot(v.e - a.e, v.n - a.n) <= HIT_FEET)
    hits.push({ anchor: a.no, distance, corner: atCorner >= 0 ? atCorner : null })
  }
  if (hits.length < MIN_HITS || !spread(hits.map((h) => pins.find((a) => a.no === h.anchor)!))) return null
  return { rotation: best.rotation, vertices, hits }
}
