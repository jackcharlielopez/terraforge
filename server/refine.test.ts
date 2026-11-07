import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs server module
import { failing, feedback, merge } from './refine.mjs'

const call = (ns: string, ew: string, deg: number, distance: number) => ({ ns, ew, deg, min: 0, sec: 0, distance, text: '' })
// a 100 x 200 rectangle: N/S legs of 200 on bearing 0 are not representable, so use near-axis bearings
const good = { label: 'A', statedAcres: null, calls: [call('N', 'E', 0.001, 200), call('S', 'E', 89.999, 100), call('S', 'W', 0.001, 200), call('N', 'W', 89.999, 100)] }
const open = { label: 'B', statedAcres: null, calls: [call('N', 'E', 0.001, 200), call('S', 'E', 89.999, 100), call('S', 'W', 0.001, 250), call('N', 'W', 89.999, 100)] }

describe('refine', () => {
  it('flags only descriptions that fail the checks', () => {
    expect(failing([good, open]).map((f: { index: number }) => f.index)).toEqual([1])
  })
  it('tells the model what failed, never what the answer is', () => {
    const f = feedback([good, open], failing([good, open]))
    expect(f).toContain('"B"')
    expect(f).not.toContain('"A"')
    expect(f).toMatch(/never adjust a number/)
  })
  it('keeps a re-read only if it comes closer to closing, and marks it', () => {
    const bad = failing([good, open])
    const better = merge([good, open], [{ ...open, calls: good.calls }], bad)
    expect(better[1].retried).toBe(true)
    const worse = merge([good, open], [{ ...open, calls: [call('N', 'E', 1, 10), call('N', 'E', 1, 10), call('N', 'E', 1, 900)] }], bad)
    expect(worse[1]).toBe(open)
  })
})
