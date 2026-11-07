import { describe, expect, it } from 'vitest'
import { buildDictionary, matchDescription } from './codes.ts'
import { buildLinework } from './linework.ts'
import { asRectangle, completeRectangles } from './rectangles.ts'
import type { CodeDef, Polyline, SurveyPoint } from './types.ts'

const P = (no: number, e: number, n: number, desc = 'HSE'): SurveyPoint => ({ no: String(no), e, n, z: 0, desc, line: no })
const def: CodeDef = { code: 'HSE', label: 'House', layer: 'V-BLDG', connect: true, closed: true }
const dict = buildDictionary([def, { code: 'EP', label: 'Edge', layer: 'V-ROAD', connect: true }, { code: 'IPF', label: 'Pin', layer: 'V-PROP', connect: false }])
const run = (pts: SurveyPoint[], lines: Polyline[] = []) => completeRectangles(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, lines)
// a 40 x 25 ft house, with the small errors of real shots
const corners = [P(1, 100, 100), P(2, 140.3, 99.6), P(3, 140, 75.2), P(4, 99.7, 74.8)]

describe('four points that make a rectangle', () => {
  it('is recognised in any shot order, and put in order round the shape', () => {
    const ring = asRectangle([corners[2], corners[0], corners[3], corners[1]])!
    expect(ring.map((p) => p.no).sort()).toEqual(['1', '2', '3', '4'])
    // going round: each neighbour in the ring is a real side, never a diagonal
    const idx = ring.map((p) => Number(p.no))
    for (let i = 0; i < 4; i++) expect(Math.abs(idx[i] - idx[(i + 1) % 4]) % 2 === 1 || [idx[i], idx[(i + 1) % 4]].sort().join() === '1,4').toBe(true)
  })
  it('accepts a square', () => {
    expect(asRectangle([P(1, 0, 0), P(2, 20, 0.2), P(3, 20.1, -20), P(4, 0, -19.8)])).not.toBeNull()
  })
  it('accepts a rectangle turned at any angle', () => {
    const t = (e: number, n: number) => ({ e: e * Math.cos(0.6) - n * Math.sin(0.6), n: e * Math.sin(0.6) + n * Math.cos(0.6) })
    expect(asRectangle([[0, 0], [40, 0], [40, 25], [0, 25]].map(([e, n], i) => P(i + 1, t(e, n).e, t(e, n).n)))).not.toBeNull()
  })
  it('rejects a trapezoid, a lopsided four-sided shape, four points on a line, and two shots of one spot', () => {
    expect(asRectangle([P(1, 0, 0), P(2, 40, 0), P(3, 30, 25), P(4, 10, 25)])).toBeNull() // trapezoid
    expect(asRectangle([P(1, 0, 0), P(2, 57, 0), P(3, 75, 37), P(4, 20, 45)])).toBeNull() // like a cleared area: no right angles
    expect(asRectangle([P(1, 0, 0), P(2, 10, 0), P(3, 20, 0), P(4, 30, 0)])).toBeNull()
    expect(asRectangle([P(1, 0, 0), P(2, 40, 0), P(3, 40, 25), P(4, 40.5, 25.5)])).toBeNull()
  })
  it('needs exactly four points', () => {
    expect(asRectangle(corners.slice(0, 3))).toBeNull()
  })
})

describe('drawing the rectangle', () => {
  it('closes four points shot out of order into one four-sided line', () => {
    const lines = run([corners[0], corners[2], corners[1], corners[3]])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ layer: 'V-BLDG', closed: true })
    expect(lines[0].vertices).toHaveLength(4)
  })
  it('redraws a closed line in shot order whose sides cross corner to corner', () => {
    const pts = [corners[0], corners[2], corners[1], corners[3]] // shot 1, 3, 2, 4: the bow-tie
    const bowtie: Polyline = { layer: 'V-BLDG', key: 'HSE', closed: true, vertices: pts.map((p) => ({ e: p.e, n: p.n, z: 0 })) }
    const out = run(pts, [bowtie])
    expect(out).toHaveLength(1)
    expect(out[0]).not.toBe(bowtie)
    // the sides now run between neighbouring corners: no side is a diagonal
    const diag = Math.hypot(40, 25)
    out[0].vertices.forEach((v, i) => {
      const w = out[0].vertices[(i + 1) % 4]
      expect(Math.hypot(v.e - w.e, v.n - w.n)).toBeLessThan(diag - 5)
    })
  })
  it('leaves a rectangle that is already drawn properly exactly as it is', () => {
    const good: Polyline = { layer: 'V-BLDG', key: 'HSE', closed: true, vertices: corners.map((p) => ({ e: p.e, n: p.n, z: 0 })) }
    const out = run(corners, [good])
    expect(out).toEqual([good])
    expect(out[0]).toBe(good)
  })
  it('does nothing for four points that are not a rectangle, five points, or points too far apart to be one feature', () => {
    expect(run([P(1, 0, 0), P(2, 40, 0), P(3, 30, 25), P(4, 10, 25)])).toEqual([])
    expect(run([...corners, P(5, 120, 90)])).toEqual([])
    expect(run([P(1, 0, 0), P(2, 40, 0), P(3, 40, 25), P(4, 0, 25), P(5, 5000, 5000), P(6, 5040, 5000), P(7, 5040, 5025), P(8, 5000, 5025)]).length).toBe(2) // two separate buildings, each closed
    expect(run([P(1, 0, 0), P(2, 500, 0), P(3, 500, 400), P(4, 0, 400)])).toEqual([])
  })
  it('leaves a feature alone when its points are also part of a longer line', () => {
    const long: Polyline = { layer: 'V-BLDG', key: 'HSE', closed: false, vertices: [...corners.map((p) => ({ e: p.e, n: p.n, z: 0 })), { e: 300, n: 300, z: 0 }] }
    expect(run(corners, [long])).toEqual([long])
  })
  it('ignores points that are not part of a line (pins) and other kinds of feature', () => {
    const pins = corners.map((p) => ({ ...p, desc: 'IPF' }))
    expect(run(pins)).toEqual([])
  })
  it('is part of the normal linework: four corners shot in a scrambled order come out as a rectangle', () => {
    const pts = [corners[0], corners[2], corners[1], corners[3]]
    const lines = buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict)
    const house = lines.filter((l) => l.layer === 'V-BLDG')
    expect(house).toHaveLength(1)
    expect(house[0].closed).toBe(true)
    expect(house[0].vertices).toHaveLength(4)
    // and nothing is drawn corner to corner
    house[0].vertices.forEach((v, i) => {
      const w = house[0].vertices[(i + 1) % 4]
      expect(Math.hypot(v.e - w.e, v.n - w.n)).toBeLessThan(Math.hypot(40, 25) - 5)
    })
  })
})
