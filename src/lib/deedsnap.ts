import type { Vertex } from './traverse.ts'

export interface Snap {
  /** The outline's corners in the drawing's coordinates, in the order of the deed. */
  vertices: Vertex[]
  /** Degrees the deed was turned to meet the outline it attaches to. */
  rotation: number
  /** Feet of line the two outlines share. */
  sharedFeet: number
  /** Which already-placed outline it attaches to (an index into the list given). */
  to: number
}

/** The shared line may differ in direction by this much (deeds of different dates use different meridians). */
const MAX_ROTATION = 15
/** Sides this close (feet) and this nearly opposite (degrees) count as the same line. */
const SAME_LINE_FEET = 3
const SAME_LINE_DEGREES = 3
/** A shared line must be at least this long, and this much of the smaller outline, to be believed. */
const MIN_SHARED_FEET = 60
const MIN_SHARED_FRACTION = 0.15

const sub = (a: Vertex, b: Vertex): Vertex => ({ e: a.e - b.e, n: a.n - b.n })
const angle = (v: Vertex) => (Math.atan2(v.e, v.n) * 180) / Math.PI // from north, clockwise
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const turn = (p: Vertex, about: Vertex, degrees: number): Vertex => {
  const c = Math.cos((degrees * Math.PI) / 180)
  const s = Math.sin((degrees * Math.PI) / 180)
  const x = p.e - about.e
  const y = p.n - about.n
  return { e: about.e + x * c + y * s, n: about.n - x * s + y * c }
}
const perimeter = (v: Vertex[]) => v.reduce((t, p, i) => t + Math.hypot(v[(i + 1) % v.length].e - p.e, v[(i + 1) % v.length].n - p.n), 0)

function inside(p: Vertex, poly: Vertex[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i].n > p.n !== poly[j].n > p.n && p.e < ((poly[j].e - poly[i].e) * (p.n - poly[i].n)) / (poly[j].n - poly[i].n) + poly[i].e) c = !c
  }
  return c
}

const centroid = (v: Vertex[]): Vertex => ({ e: v.reduce((t, p) => t + p.e, 0) / v.length, n: v.reduce((t, p) => t + p.n, 0) / v.length })

/** Length of the stretch of segment (c, d) that lies along segment (a, b) running the opposite way, within the tolerances; 0 when it does not. */
function sharedAlong(a: Vertex, b: Vertex, c: Vertex, d: Vertex): number {
  const ab = sub(b, a)
  const len = Math.hypot(ab.e, ab.n)
  const cd = sub(d, c)
  if (len === 0 || Math.hypot(cd.e, cd.n) === 0) return 0
  if (Math.abs(wrap(angle(cd) - angle(ab) - 180)) > SAME_LINE_DEGREES) return 0
  const ux = ab.e / len
  const uy = ab.n / len
  const off = (p: Vertex) => Math.abs((p.e - a.e) * uy - (p.n - a.n) * ux)
  if (off(c) > SAME_LINE_FEET || off(d) > SAME_LINE_FEET) return 0
  const along = (p: Vertex) => (p.e - a.e) * ux + (p.n - a.n) * uy
  const lo = Math.max(0, Math.min(along(c), along(d)))
  const hi = Math.min(len, Math.max(along(c), along(d)))
  return Math.max(0, hi - lo)
}

/** A side of the new outline matches a side of the placed one when their lengths agree within this (feet, or this share of the length). */
const SIDE_TOLERANCE_FEET = 3
const SIDE_TOLERANCE_SHARE = 0.02
/** Two attachments are the same place when their middles are within this many feet. */
const SAME_PLACE_FEET = 20

/**
 * Place an outline that has no pins on it by attaching it to one already placed. Neighbours share a line: it is a side of one and, run the
 * other way, a side of the other. Only a side that matches a side of the placed outline in length can fix the position (a shorter one could
 * slide along a longer line), so try every such pair of sides: turn the new outline to make the two exactly opposite and bring both ends
 * together. Keep the attachment with the most shared line, provided the outlines do not overlap and the shared line is long enough to be
 * believed. Where two different attachments are equally good (equal sides can sit on either side of a neighbour) nothing is placed: it is not
 * for this to guess. Returns null when nothing attaches convincingly.
 */
export function snapToOutlines(corners: Vertex[], placed: Vertex[][]): Snap | null {
  if (corners.length < 3 || placed.length === 0) return null
  const own = perimeter(corners)
  const found: Array<Snap & { score: number }> = []
  for (let k = 0; k < placed.length; k++) {
    const other = placed[k]
    const threshold = Math.max(MIN_SHARED_FEET, MIN_SHARED_FRACTION * Math.min(own, perimeter(other)))
    for (let i = 0; i < corners.length; i++) {
      const e0 = corners[i]
      const e1 = corners[(i + 1) % corners.length]
      const eLen = Math.hypot(e1.e - e0.e, e1.n - e0.n)
      for (let j = 0; j < other.length; j++) {
        const f0 = other[j]
        const f1 = other[(j + 1) % other.length]
        const fLen = Math.hypot(f1.e - f0.e, f1.n - f0.n)
        if (Math.abs(eLen - fLen) > Math.max(SIDE_TOLERANCE_FEET, SIDE_TOLERANCE_SHARE * fLen)) continue
        const rotation = wrap(angle(sub(f1, f0)) + 180 - angle(sub(e1, e0)))
        if (Math.abs(rotation) > MAX_ROTATION) continue
        // e0 meets f1 and e1 meets f0: the two sides coincide, running opposite ways
        const turned = corners.map((p) => turn(p, e0, rotation))
        const dx = f1.e - turned[i].e
        const dy = f1.n - turned[i].n
        const moved = turned.map((p) => ({ e: p.e + dx, n: p.n + dy }))
        let shared = 0
        for (let a = 0; a < moved.length; a++) {
          for (let b = 0; b < other.length; b++) shared += sharedAlong(other[b], other[(b + 1) % other.length], moved[a], moved[(a + 1) % moved.length])
        }
        if (shared < threshold) continue
        // neighbours sit side by side: reject an attachment that puts one outline inside the other
        if (inside(centroid(moved), other) || inside(centroid(other), moved)) continue
        found.push({ vertices: moved, rotation, sharedFeet: shared, to: k, score: shared })
      }
    }
  }
  if (found.length === 0) return null
  found.sort((a, b) => b.score - a.score)
  const best = found[0]
  const here = centroid(best.vertices)
  const rival = found.find((f) => f !== best && f.score >= 0.95 * best.score && Math.hypot(centroid(f.vertices).e - here.e, centroid(f.vertices).n - here.n) > SAME_PLACE_FEET)
  if (rival) return null
  return { vertices: best.vertices, rotation: best.rotation, sharedFeet: best.sharedFeet, to: best.to }
}
