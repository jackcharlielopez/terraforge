import { describe, expect, it } from 'vitest'
import { pinLinesAlong } from './pinlines.ts'
import type { Polyline } from './types.ts'

const lot: Polyline = { layer: 'DEED', key: 'deed', closed: true, vertices: [{ e: 0, n: 0, z: 0 }, { e: 200, n: 0, z: 0 }, { e: 200, n: 700, z: 0 }, { e: 0, n: 700, z: 0 }] }
const pin = (no: string, e: number, n: number) => ({ no, e, n })

describe('pin lines along a deed outline', () => {
  it('joins the pins on each side, in order along the side', () => {
    const pins = [pin('2', 200.5, 0.4), pin('1', -0.3, 0.2), pin('3', 199.6, 350), pin('4', 200, 699.5)]
    const lines = pinLinesAlong(lot, pins)
    expect(lines.map((l) => l.vertices.map((x) => x.n))).toEqual([[0.4, 0.2].reverse(), [0.4, 350], [350, 699.5]])
    expect(lines.every((l) => l.layer === 'V-PROP' && !l.closed)).toBe(true)
  })
  it('never joins a pin that is not on the outline (the neighbour\'s)', () => {
    const lines = pinLinesAlong(lot, [pin('1', 0, 0), pin('2', 200, 0), pin('9', 260, 300), pin('8', 300, 300)])
    expect(lines).toHaveLength(1)
  })
  it('draws nothing for a side with fewer than two pins, or for two shots of one spot', () => {
    expect(pinLinesAlong(lot, [pin('1', 100, 0.5)])).toEqual([])
    expect(pinLinesAlong(lot, [pin('1', 100, 0), pin('2', 100.3, 0.2)])).toEqual([])
  })
  it('does not repeat a line a corner pin would give twice, and leaves an open outline unclosed', () => {
    const closed = pinLinesAlong(lot, [pin('1', 0, 0), pin('2', 200, 0), pin('3', 200, 700), pin('4', 0, 700)])
    expect(closed).toHaveLength(4)
    const open = pinLinesAlong({ ...lot, closed: false }, [pin('1', 0, 0), pin('2', 200, 0), pin('3', 200, 700), pin('4', 0, 700)])
    expect(open).toHaveLength(3)
  })
})
