import { arcAngle } from './traverse.ts'

export interface ArcSide {
  /** Which side of the outline: the side from corner `index` to the next corner. */
  index: number
  radius: number
  /** Which way the line turns as it is walked: a right turn bulges to the left of its chord. */
  direction: 'L' | 'R'
}

interface P {
  e: number
  n: number
  z: number
}

/** An arc may stray from a straight piece of itself by at most this many feet: it sets how many points an arc gets. */
export const MAX_SAGITTA_FEET = 0.25
const MAX_ARC_POINTS = 128

/**
 * An outline's corners are the ends of its chords. Where a side is a circular arc, put points along the arc between its two corners
 * so the line is drawn curved. The corners themselves are untouched (placement and the closure checks use them), and a side whose
 * radius cannot span its chord stays straight. `closed` says whether the last corner joins the first by a side of its own.
 */
export function densify(vertices: P[], closed: boolean, arcs: ArcSide[]): P[] {
  if (arcs.length === 0) return vertices
  const byIndex = new Map(arcs.map((a) => [a.index, a]))
  const out: P[] = []
  const n = vertices.length
  const sides = closed ? n : n - 1
  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    out.push(a)
    const arc = byIndex.get(i)
    if (!arc || i >= sides) continue
    const b = vertices[(i + 1) % n]
    const chord = Math.hypot(b.e - a.e, b.n - a.n)
    const theta = arcAngle(chord, arc.radius)
    if (theta === null || chord < 1e-6 || arc.radius <= MAX_SAGITTA_FEET) continue
    // unit chord and its left normal; a right turn bulges to the left, a left turn to the right
    const ue = (b.e - a.e) / chord
    const un = (b.n - a.n) / chord
    const side = arc.direction === 'R' ? 1 : -1
    const be = -un * side
    const bn = ue * side
    const half = Math.cos(theta / 2)
    const cE = (a.e + b.e) / 2 - be * arc.radius * half
    const cN = (a.n + b.n) / 2 - bn * arc.radius * half
    // which way round the centre the arc runs from a to b: the way that passes the bulge point
    const a0e = a.e - cE
    const a0n = a.n - cN
    const mid = { e: cE + be * arc.radius, n: cN + bn * arc.radius }
    const turn = Math.sign(a0e * (mid.n - cN) - a0n * (mid.e - cE)) || 1
    const segments = Math.min(MAX_ARC_POINTS, Math.max(1, Math.ceil(theta / (2 * Math.acos(Math.max(-1, 1 - MAX_SAGITTA_FEET / arc.radius))))))
    for (let k = 1; k < segments; k++) {
      const t = (turn * theta * k) / segments
      out.push({ e: cE + a0e * Math.cos(t) - a0n * Math.sin(t), n: cN + a0e * Math.sin(t) + a0n * Math.cos(t), z: a.z })
    }
  }
  return out
}

/** Area (square feet) of a closed ring, and the length (feet) of a path. */
export function ringArea(v: P[]): number {
  let twice = 0
  v.forEach((p, i) => {
    const q = v[(i + 1) % v.length]
    twice += p.e * q.n - q.e * p.n
  })
  return Math.abs(twice) / 2
}
export function pathLength(v: P[], closed: boolean): number {
  let sum = 0
  for (let i = 0; i < (closed ? v.length : v.length - 1); i++) sum += Math.hypot(v[(i + 1) % v.length].e - v[i].e, v[(i + 1) % v.length].n - v[i].n)
  return sum
}
