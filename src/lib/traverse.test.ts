import { describe, expect, it } from 'vitest'
import { boundaryCalls } from './deedcalls.ts'
import type { Call } from './deedcalls.ts'
import { assess, traverse } from './traverse.ts'

const rect = (sideA: number, sideB: number, extra = '') =>
  `Beginning at a stake; thence South 04 degrees 00 minutes West ${sideA} feet; thence North 86 degrees 00 minutes West ${sideB} feet; thence North 04 degrees 00 minutes East ${sideA + (extra ? 18 : 0)} feet; thence South 86 degrees 00 minutes East ${sideB} feet to the beginning.`

describe('walking the calls', () => {
  it('closes a rectangle exactly, with its area', () => {
    const t = traverse(boundaryCalls(rect(200, 150)))!
    expect(t.misclosure).toBeLessThan(0.01)
    expect(t.ratio).toBe(Infinity)
    expect(t.areaSqFt).toBeCloseTo(30000, 0)
    expect(t.areaAcres).toBeCloseTo(0.689, 2)
    expect(t.vertices).toHaveLength(5)
  })
  it('measures how far a description misses closing', () => {
    const t = traverse(boundaryCalls(rect(200, 150, 'x')))!
    expect(t.misclosure).toBeCloseTo(18, 1)
    expect(Math.round(t.ratio)).toBe(Math.round(t.perimeter / 18))
  })
  it('needs at least two readable calls', () => {
    expect(traverse([])).toBeNull()
  })
})

describe('is the read to be trusted?', () => {
  it('passes a description that closes and matches its stated acreage', () => {
    expect(assess(boundaryCalls(rect(200, 150)), 0.69)).toMatchObject({ verdict: 'ok', reasons: [] })
  })
  it('passes a description that closes when it states no acreage', () => {
    expect(assess(boundaryCalls(rect(200, 150)), null).verdict).toBe('ok')
  })
  it('fails one that does not close, and says by how much', () => {
    const a = assess(boundaryCalls(rect(200, 150, 'x')), null)
    expect(a.verdict).toBe('fail')
    expect(a.reasons[0]).toMatch(/does not close: 18\.0 ft off/)
  })
  it('fails one whose area is not the stated acreage, even if it closes', () => {
    const a = assess(boundaryCalls(rect(200, 150)), 1.0)
    expect(a.verdict).toBe('fail')
    expect(a.reasons[0]).toMatch(/area 0\.69 acres, but the deed says 1/)
  })
  it('asks for a check when a bearing was filled in from the opposite side', () => {
    const calls = boundaryCalls('Beginning at a stake; thence South 4 degrees West 200 feet; thence North 86 degrees West 150 feet; thence North % degrees East 200 feet; thence South 86 degrees East 150 feet to the beginning.')
    expect(assess(calls, null)).toMatchObject({ verdict: 'check' })
  })
  it('fails when there are too few calls or a bearing is unreadable', () => {
    expect(assess(boundaryCalls('Beginning; thence South 4 degrees West 200 feet; thence North 86 degrees West 150 feet'), null).verdict).toBe('fail')
    const unreadable = boundaryCalls('Beginning; thence South 4 degrees West 200 feet; thence North 86 degrees West 150 feet; thence North % degrees East 77 feet; thence South 86 degrees East 150 feet')
    expect(assess(unreadable, null).reasons.join(' ')).toMatch(/could not be read/)
  })
})

describe('curves', () => {
  const line = (ns: 'N' | 'S', ew: 'E' | 'W', deg: number, distance: number, extra: Partial<Call> = {}): Call => ({ ns, ew, deg, min: 0, sec: 0, distance, unsure: false, text: '', ...extra })
  // a 100 ft square, walked clockwise from its south-west corner: north, east (this side is the curve), south, west
  const square = (east: Partial<Call>) => [line('N', 'E', 0, 100), line('N', 'E', 90, 100, east), line('S', 'E', 0, 100), line('N', 'W', 90, 100)]
  const sliver = (R: number, chord: number) => {
    const t = 2 * Math.asin(chord / (2 * R))
    return (R * R * (t - Math.sin(t))) / 2
  }
  it('adds the sliver when the curve turns right (it bulges outward on a clockwise ring)', () => {
    const t = traverse(square({ curve: { direction: 'R', radius: 100 } }))!
    expect(t.areaSqFt).toBeCloseTo(10000 + sliver(100, 100), 1)
    expect(t.curves).toBe(1)
  })
  it('takes it away when the curve turns left (it bulges inward)', () => {
    expect(traverse(square({ curve: { direction: 'L', radius: 100 } }))!.areaSqFt).toBeCloseTo(10000 - sliver(100, 100), 1)
  })
  it('uses the arc, not the chord, for the perimeter', () => {
    const t = traverse(square({ curve: { direction: 'R', radius: 100 } }))!
    expect(t.perimeter).toBeCloseTo(300 + 100 * 2 * Math.asin(0.5), 3)
  })
  it('leaves straight calls alone', () => {
    expect(traverse(square({}))!.areaSqFt).toBeCloseTo(10000, 3)
    expect(traverse(square({}))!.curves).toBe(0)
  })
  it('passes a curved parcel whose stated acreage includes the curve, and fails one that ignores it', () => {
    const a = (10000 + sliver(100, 100)) / 43560
    expect(assess(square({ curve: { direction: 'R', radius: 100 } }), a).verdict).toBe('ok')
    expect(assess(square({ curve: { direction: 'R', radius: 100 } }), 10000 / 43560).verdict).toBe('fail')
  })
  it('fails a curve that cannot span its chord, or whose arc length does not fit', () => {
    expect(assess(square({ curve: { direction: 'R', radius: 40 } }), null).reasons.join(' ')).toMatch(/cannot span/)
    const good = 100 * 2 * Math.asin(0.5)
    expect(assess(square({ curve: { direction: 'R', radius: 100, arcLength: good } }), null).reasons.join(' ')).not.toMatch(/arc length/)
    expect(assess(square({ curve: { direction: 'R', radius: 100, arcLength: good + 8 } }), null).reasons.join(' ')).toMatch(/arc length/)
  })
})
