import type { Vertex } from './traverse.ts'

function inside(p: Vertex, poly: Vertex[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.n > p.n !== b.n > p.n && p.e < ((b.e - a.e) * (p.n - a.n)) / (b.n - a.n) + a.e) c = !c
  }
  return c
}

const area = (v: Vertex[]) => Math.abs(v.reduce((s, p, i) => s + p.e * v[(i + 1) % v.length].n - v[(i + 1) % v.length].e * p.n, 0)) / 2

/** Sample spacing grid: this many points across the longer side of the smaller outline. */
const GRID = 60

/** How much of the smaller outline lies inside the other (0 to 1), by sampling. */
export function overlapFraction(a: Vertex[], b: Vertex[]): number {
  const [small, big] = area(a) <= area(b) ? [a, b] : [b, a]
  const e = small.map((p) => p.e)
  const n = small.map((p) => p.n)
  const [e0, e1, n0, n1] = [Math.min(...e), Math.max(...e), Math.min(...n), Math.max(...n)]
  const step = Math.max(e1 - e0, n1 - n0) / GRID
  if (step <= 0) return 0
  let inSmall = 0
  let inBoth = 0
  for (let x = e0 + step / 2; x < e1; x += step) {
    for (let y = n0 + step / 2; y < n1; y += step) {
      const p = { e: x, n: y }
      if (!inside(p, small)) continue
      inSmall++
      if (inside(p, big)) inBoth++
    }
  }
  return inSmall === 0 ? 0 : inBoth / inSmall
}

/** Below this much overlap two outlines are neighbours (edges meet, with a little give for old deeds). */
export const TOUCH_FRACTION = 0.08
/** Above this much the smaller lies within the larger: a lot inside the tract it was cut from, or a second deed's copy of the same land. */
export const WITHIN_FRACTION = 0.8

/**
 * Two outlines of different parcels cannot lie partly on top of each other: they are side by side (neighbours), or one is inside the
 * other (a lot cut from a tract). Anything in between means one of them is in the wrong place.
 */
export function partlyOverlaps(a: Vertex[], b: Vertex[]): boolean {
  const f = overlapFraction(a, b)
  return f > TOUCH_FRACTION && f < WITHIN_FRACTION
}
