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

/**
 * Place a computed outline on the drawing using the pins found in the field. The deed gives the shape; the pins give where it is and
 * which way it points: turn it a little (old bearings) and slide it so that as many found pins as possible lie on its lines. At least
 * three must, and not all on one line. Returns null when that cannot be shown.
 */
export function fitOutline(corners: Vertex[], anchors: Anchor[]): Placement | null {
  if (corners.length < 3 || corners.length > MAX_CORNERS || anchors.length < MIN_HITS) return null
  const pins = anchors.slice(0, MAX_ANCHORS)

  const trial = (rotation: number) => {
    const shape = turn(corners, rotation)
    let best: { score: number; dx: number; dy: number } | null = null
    for (const p of shape) {
      for (const a of pins) {
        const dx = a.e - p.e
        const dy = a.n - p.n
        let score = 0
        for (const b of pins) {
          score += Math.min(distanceToOutline(b.e, b.n, shape, dx, dy), SCORE_CAP)
          if (shape.some((q) => Math.hypot(q.e + dx - b.e, q.n + dy - b.n) <= CORNER_FEET)) score -= CORNER_BONUS
        }
        score += TURN_PENALTY * Math.abs(rotation)
        if (!best || score < best.score) best = { score, dx, dy }
      }
    }
    return best ? { ...best, rotation, shape } : null
  }

  let best: NonNullable<ReturnType<typeof trial>> | null = null
  for (let r = -MAX_ROTATION; r <= MAX_ROTATION + 1e-9; r += 0.25) {
    const t = trial(r)
    if (t && (!best || t.score < best.score)) best = t
  }
  if (!best) return null
  const coarse = best.rotation
  for (let r = coarse - 0.3; r <= coarse + 0.3 + 1e-9; r += 0.02) {
    const t = trial(r)
    if (t && t.score < best.score) best = t
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
