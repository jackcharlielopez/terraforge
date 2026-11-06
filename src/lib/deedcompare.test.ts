import { describe, expect, it } from 'vitest'
import { boundaryCalls } from './deedcalls.ts'
import { compareCalls } from './deedcompare.ts'

const desc = (calls: string[]) => `Beginning at a stake; ${calls.map((c) => `thence ${c}`).join('; ')} to the beginning.`
const ORIGINAL = ['South 4 degrees West 200 feet', 'North 86 degrees West 150 feet', 'North 4 degrees East 200 feet', 'South 86 degrees East 139 1/2 feet', 'South 10 degrees East 60 feet']
const read = (calls: string[]) => boundaryCalls(desc(calls))

describe('comparing two deeds that describe the same land', () => {
  it('finds nothing to say about identical descriptions', () => {
    const c = compareCalls(read(ORIGINAL), read(ORIGINAL))!
    expect(c.agree).toBe(5)
    expect(c.differences).toEqual([])
  })
  it('names the call whose digit drifted in a retyped copy', () => {
    const copy = [...ORIGINAL]
    copy[3] = 'South 86 degrees East 138 1/2 feet'
    const c = compareCalls(read(ORIGINAL), read(copy))!
    expect(c.agree).toBe(4)
    expect(c.differences).toHaveLength(1)
    expect(c.differences[0].here).toContain('139.50')
    expect(c.differences[0].there).toContain('138.50')
  })
  it('notices a call that was dropped or repeated', () => {
    const dropped = ORIGINAL.filter((_, i) => i !== 2)
    const c = compareCalls(read(ORIGINAL), read(dropped))!
    expect(c.agree).toBe(4)
    expect(c.differences).toEqual([{ here: expect.stringContaining('N 04°00\'00" E 200.00'), there: null }])
  })
  it('says nothing about descriptions of different land, or ones with too few calls', () => {
    const other = ['North 30 degrees East 300 feet', 'South 60 degrees East 250 feet', 'South 30 degrees West 300 feet', 'North 60 degrees West 250 feet']
    expect(compareCalls(read(ORIGINAL), read(other))).toBeNull()
    expect(compareCalls(read(ORIGINAL).slice(0, 2), read(ORIGINAL))).toBeNull()
  })
})
