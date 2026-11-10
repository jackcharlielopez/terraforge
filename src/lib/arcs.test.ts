import { describe, expect, it } from 'vitest'
import { densify, pathLength, ringArea } from './arcs.ts'

const p = (e: number, n: number) => ({ e, n, z: 0 })

describe('densify', () => {
  // a 100 ft chord running east, radius 100: a 60 degree arc with a sagitta of 100(1 - cos 30) = 13.4 ft
  const chord = [p(0, 0), p(100, 0)]
  it('bulges to the left for a right turn, passing through the true midpoint of the arc', () => {
    const v = densify(chord, false, [{ index: 0, radius: 100, direction: 'R' }])
    expect(v.length).toBeGreaterThan(8)
    const top = Math.max(...v.map((q) => q.n))
    expect(top).toBeCloseTo(100 * (1 - Math.cos(Math.PI / 6)), 1)
    expect(Math.min(...v.map((q) => q.n))).toBeGreaterThanOrEqual(-1e-9)
  })
  it('bulges to the right for a left turn', () => {
    const v = densify(chord, false, [{ index: 0, radius: 100, direction: 'L' }])
    expect(Math.min(...v.map((q) => q.n))).toBeCloseTo(-100 * (1 - Math.cos(Math.PI / 6)), 1)
  })
  it('keeps every point on the circle, in order from one corner to the other, and the corners untouched', () => {
    const v = densify(chord, false, [{ index: 0, radius: 100, direction: 'R' }])
    expect(v[0]).toEqual(chord[0])
    expect(v[v.length - 1]).toEqual(chord[1])
    const cN = -100 * Math.cos(Math.PI / 6)
    for (const q of v) expect(Math.hypot(q.e - 50, q.n - cN)).toBeCloseTo(100, 6)
    for (let i = 1; i < v.length; i++) expect(v[i].e).toBeGreaterThan(v[i - 1].e)
  })
  it('has the arc length of the arc, within the sagitta limit', () => {
    const v = densify(chord, false, [{ index: 0, radius: 100, direction: 'R' }])
    expect(pathLength(v, false)).toBeGreaterThan(100)
    expect(Math.abs(pathLength(v, false) - 100 * (Math.PI / 3))).toBeLessThan(0.1)
  })
  it('curves the closing side of a closed outline, and adds the arc sliver to the area', () => {
    const ring = [p(0, 0), p(0, 100), p(100, 100), p(100, 0)] // clockwise square
    const v = densify(ring, true, [{ index: 2, radius: 100, direction: 'R' }]) // the south-flowing east side... bulges east (left of travel south)
    const t = Math.PI / 3
    // short straight pieces inside the arc lose a sliver of the sliver: well under a quarter of a percent of the area
    expect(Math.abs(ringArea(v) - (10000 + (100 * 100 * (t - Math.sin(t))) / 2))).toBeLessThan(25)
    expect(ringArea(v)).toBeGreaterThan(10800)
  })
  it('leaves a side straight when the radius cannot span it, or there is no arc', () => {
    expect(densify(chord, false, [{ index: 0, radius: 40, direction: 'R' }])).toEqual(chord)
    expect(densify(chord, false, [])).toBe(chord)
  })
})
