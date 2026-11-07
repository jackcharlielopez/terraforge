import { describe, expect, it } from 'vitest'
import { boundaryCalls } from './deedcalls.ts'
import { assess } from './traverse.ts'
import { applyRepair, suggestRepairs } from './repair.ts'

const rect = (a: number, b: number, c: number, d: number, bearings = ['South 04 degrees 00 minutes West', 'North 86 degrees 00 minutes West', 'North 04 degrees 00 minutes East', 'South 86 degrees 00 minutes East']) =>
  `Beginning at a stake; thence ${bearings[0]} ${a} feet; thence ${bearings[1]} ${b} feet; thence ${bearings[2]} ${c} feet; thence ${bearings[3]} ${d} feet to the beginning.`

describe('suggesting a repair for a description that does not close', () => {
  it('finds the swapped digits when the acreage says which side is right', () => {
    // sides of 257 and 275 ft: 1.26 acres is 275 x 200, so it is the 257 that is wrong
    const calls = boundaryCalls(rect(257, 200, 275, 200))
    expect(assess(calls, 1.26).verdict).toBe('fail')
    const r = suggestRepairs(calls, 1.26)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ index: 0, what: 'distance', from: "257.00'", to: "275.00'" })
    expect(r[0].ratio).toBeGreaterThan(MIN)
    expect(r[0].areaAcres).toBeCloseTo(1.26, 2)
  })
  it('offers both sides when nothing says which is right, so the surveyor can choose', () => {
    const calls = boundaryCalls(rect(200, 158, 200, 150))
    const r = suggestRepairs(calls, null)
    expect(r.map((x) => [x.index, x.to]).sort()).toEqual([
      [1, "150.00'"],
      [3, "158.00'"],
    ])
  })
  it('finds a misread degree', () => {
    const calls = boundaryCalls(rect(200, 150, 200, 150, ['South 04 degrees 00 minutes West', 'North 86 degrees 00 minutes West', 'North 04 degrees 00 minutes East', 'South 88 degrees 00 minutes East']))
    const r = suggestRepairs(calls, null)
    expect(r.some((x) => x.index === 3 && x.what === 'degrees' && x.to.startsWith('S 86°'))).toBe(true)
  })
  it('finds a flipped quadrant letter', () => {
    const calls = boundaryCalls(rect(200, 150, 200, 150, ['South 04 degrees 00 minutes West', 'North 86 degrees 00 minutes West', 'South 04 degrees 00 minutes East', 'South 86 degrees 00 minutes East']))
    const r = suggestRepairs(calls, null)
    expect(r.some((x) => x.index === 2 && x.what === 'direction')).toBe(true)
  })
  it('offers nothing for a description that already closes', () => {
    expect(suggestRepairs(boundaryCalls(rect(200, 150, 200, 150)), null)).toEqual([])
  })
  it('offers nothing when no single edit closes it', () => {
    // two sides wrong at once
    expect(suggestRepairs(boundaryCalls(rect(207, 150, 200, 163)), null)).toEqual([])
  })
  it('will not touch a description with an unreadable bearing', () => {
    expect(suggestRepairs(boundaryCalls('Beginning; thence South 4 degrees West 200 feet; thence North 86 degrees West 150 feet; thence North % degrees East 77 feet; thence South 86 degrees East 150 feet'), null)).toEqual([])
  })
  it('applying a repair changes that call only, marks it, and then the read needs a check instead of failing', () => {
    const calls = boundaryCalls(rect(257, 200, 275, 200))
    const [fix] = suggestRepairs(calls, 1.26)
    const fixed = applyRepair(calls, fix)
    expect(fixed[0].distance).toBe(275)
    expect(fixed.slice(1).map((c) => c.distance)).toEqual(calls.slice(1).map((c) => c.distance))
    expect(fixed[0].inferred).toMatch(/changed from 257\.00' to 275\.00'/)
    expect(assess(fixed, 1.26)).toMatchObject({ verdict: 'check' })
  })
})

const MIN = 5000
