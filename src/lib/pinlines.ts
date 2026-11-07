import type { Polyline } from './types.ts'

/** A pin must lie this close to a side of the deed outline to count as being on it (the outline is fitted to pins within about 10 ft). */
export const ON_SIDE_FEET = 8
/** Two pins closer than this are the same spot shot twice: no line between them. */
const MIN_LINE_FEET = 1

interface Pin {
  no: string
  e: number
  n: number
}

/**
 * The property line the way the drafter draws it: pin to pin. Each side of a trusted deed outline that runs through found pins gets
 * a line from one pin to the next along it. Only pins sitting on the outline are used, so a neighbour's pins are never joined. An
 * outline side with fewer than two pins on it gets nothing.
 */
export function pinLinesAlong(outline: Polyline, pins: readonly Pin[]): Polyline[] {
  const v = outline.vertices
  const sides = outline.closed ? v.length : v.length - 1
  const made = new Set<string>()
  const lines: Polyline[] = []
  for (let s = 0; s < sides; s++) {
    const a = v[s]
    const b = v[(s + 1) % v.length]
    const de = b.e - a.e
    const dn = b.n - a.n
    const len2 = de * de + dn * dn
    if (len2 === 0) continue
    const on: Array<{ pin: Pin; t: number }> = []
    for (const pin of pins) {
      const t = ((pin.e - a.e) * de + (pin.n - a.n) * dn) / len2
      if (t < -0.02 || t > 1.02) continue
      const off = Math.hypot(pin.e - (a.e + t * de), pin.n - (a.n + t * dn))
      if (off <= ON_SIDE_FEET) on.push({ pin, t })
    }
    on.sort((x, y) => x.t - y.t)
    for (let i = 1; i < on.length; i++) {
      const p = on[i - 1].pin
      const q = on[i].pin
      if (Math.hypot(p.e - q.e, p.n - q.n) < MIN_LINE_FEET) continue
      const key = p.no < q.no ? `${p.no}|${q.no}` : `${q.no}|${p.no}`
      if (made.has(key)) continue
      made.add(key)
      lines.push({ layer: 'V-PROP', key: 'pin-line', closed: false, vertices: [{ e: p.e, n: p.n, z: 0 }, { e: q.e, n: q.n, z: 0 }] })
    }
  }
  return lines
}
