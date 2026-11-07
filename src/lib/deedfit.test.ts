import { describe, expect, it } from 'vitest'
import { fitOutline, tooBigToFit } from './deedfit.ts'

// A 200 x 150 ft lot whose bearings are 2.1 degrees off the grid, sitting at (1000, 2000).
const shape = [
  { e: 0, n: 0 },
  { e: -13.95, n: -199.51 },
  { e: -163.58, n: -189.05 },
  { e: -149.63, n: 10.46 },
]
const placed = (rotation: number, at = { e: 1000, n: 2000 }) => {
  const c = Math.cos((rotation * Math.PI) / 180)
  const s = Math.sin((rotation * Math.PI) / 180)
  return shape.map((p) => ({ e: p.e * c + p.n * s + at.e, n: -p.e * s + p.n * c + at.n }))
}

describe('placing an outline on found pins', () => {
  it('finds where it sits and how far to turn it, when three corners are on pins', () => {
    const t = placed(2.1)
    const anchors = [
      { no: '1', e: t[0].e, n: t[0].n },
      { no: '2', e: t[1].e, n: t[1].n },
      { no: '3', e: t[2].e, n: t[2].n },
      { no: '9', e: 1500, n: 2600 },
    ]
    const p = fitOutline(shape, anchors)!
    expect(p.rotation).toBeCloseTo(2.1, 1)
    expect(p.hits.length).toBeGreaterThanOrEqual(3)
    p.vertices.forEach((v, i) => {
      expect(v.e).toBeCloseTo(t[i].e, 1)
      expect(v.n).toBeCloseTo(t[i].n, 1)
    })
  })
  it('needs no turning when the deed is already on the grid', () => {
    const t = placed(0)
    const p = fitOutline(shape, t.map((v, i) => ({ no: String(i), e: v.e, n: v.n })))!
    expect(Math.abs(p.rotation)).toBeLessThan(0.1)
    expect(p.hits).toHaveLength(4)
  })
  it('counts a pin lying along an edge, not only at a corner', () => {
    const t = placed(2.1)
    const mid = { e: (t[1].e + t[2].e) / 2, n: (t[1].n + t[2].n) / 2 } // halfway along the south side
    const p = fitOutline(shape, [t[0], t[1], mid].map((v, i) => ({ no: String(i), e: v.e, n: v.n })))!
    expect(p.hits).toHaveLength(3)
    expect(p.hits.filter((h) => h.corner === null)).toHaveLength(1)
    expect(p.rotation).toBeCloseTo(2.1, 1)
  })
  it('will not place it when all the pins are on one line: it could slide along it', () => {
    const t = placed(2.1)
    const along = [0.3, 0.5, 0.7].map((f, i) => ({ no: String(i), e: t[1].e + (t[2].e - t[1].e) * f, n: t[1].n + (t[2].n - t[1].n) * f }))
    expect(fitOutline(shape, along)).toBeNull()
  })
  it('will not place it on only two pins: two can always be matched by turning', () => {
    const t = placed(2.1)
    expect(fitOutline(shape, [t[0], t[1]].map((v, i) => ({ no: String(i), e: v.e, n: v.n })))).toBeNull()
  })
  it('will not place it when the pins are not where the corners are', () => {
    const anchors = [
      { no: 'a', e: 10, n: 10 },
      { no: 'b', e: 400, n: 90 },
      { no: 'c', e: 120, n: 700 },
      { no: 'd', e: 800, n: 300 },
    ]
    expect(fitOutline(shape, anchors)).toBeNull()
  })
  it('gives up, rather than freeze the page, on a huge outline with many pins', () => {
    const big = Array.from({ length: 70 }, (_, i) => ({ e: 500 * Math.cos((i / 70) * 6.283), n: 500 * Math.sin((i / 70) * 6.283) }))
    const pins = Array.from({ length: 25 }, (_, i) => ({ no: `p${i}`, e: i * 40, n: i * 25 }))
    expect(tooBigToFit(big.slice(0, 60), pins)).toBe(true)
    expect(tooBigToFit(shape, pins)).toBe(false)
    expect(fitOutline(big.slice(0, 60), pins)).toBeNull()
  })
  // A 200 x 711 ft lot (sides as a deed gives them), and helpers to turn it
  const lot = [
    { e: 0, n: 0 },
    { e: -13.95, n: -709.18 },
    { e: -213.34, n: -697.03 },
    { e: -199.4, n: 12.15 },
  ]
  const turnBy = (v: typeof lot, deg: number, about: { e: number; n: number }) => {
    const c = Math.cos((deg * Math.PI) / 180)
    const s = Math.sin((deg * Math.PI) / 180)
    return v.map((p) => ({ e: about.e + (p.e - about.e) * c + (p.n - about.n) * s, n: about.n - (p.e - about.e) * s + (p.n - about.n) * c }))
  }
  it('finds a turn that falls between the search steps: three pins on corners of a long lot fix it to a few hundredths of a degree', () => {
    for (const turned of [2.13, 2.37, 0.88, -3.61]) {
      const truth = turnBy(lot, turned, { e: 0, n: 0 }).map((p) => ({ e: p.e + 5000, n: p.n + 5000 }))
      const p = fitOutline(lot, truth.slice(0, 3).map((v, i) => ({ no: `p${i}`, e: v.e, n: v.n })))!
      expect(p.rotation, `turn ${turned}`).toBeCloseTo(turned, 1)
      expect(p.hits.filter((h) => h.corner !== null), `turn ${turned}`).toHaveLength(3)
    }
  })
  it('prefers the arrangement that puts more pins on the outline when two nearly fit', () => {
    // a second arrangement, turned 1.4 degrees more about the south-east pin, has pins at its own corners too
    const truth = turnBy(lot, 2.13, { e: 0, n: 0 }).map((p) => ({ e: p.e + 5000, n: p.n + 5000 }))
    const alt = turnBy(truth, 1.4, truth[1])
    const both = [truth[0], truth[1], truth[2], alt[0], alt[2]].map((p, i) => ({ no: `p${i}`, e: p.e, n: p.n }))
    expect(fitOutline(lot, both)!.rotation).toBeGreaterThan(3)
    // with only the true pins, the true arrangement is found
    expect(fitOutline(lot, both.slice(0, 3))!.rotation).toBeCloseTo(2.13, 1)
  })
  it('returns nothing for too few corners or pins', () => {
    expect(fitOutline(shape.slice(0, 2), [])).toBeNull()
    expect(fitOutline(shape, [])).toBeNull()
  })
})
