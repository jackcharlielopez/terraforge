import { describe, expect, it } from 'vitest'
import { placeAll } from './deedplace.ts'
import { snapToOutlines } from './deedsnap.ts'

// Lots side by side, each side shared with its neighbour a different length so that only one attachment is right:
// A | B | C, with A's east side 300 ft, B's west side 300 and east side 270, C's west side 270.
const A = [
  { e: 0, n: 0 },
  { e: 200, n: 0 },
  { e: 200, n: -300 },
  { e: 0, n: -320 },
]
const B = [
  { e: 200, n: 0 },
  { e: 350, n: 0 },
  { e: 350, n: -270 },
  { e: 200, n: -300 },
]
const C = [
  { e: 350, n: 0 },
  { e: 500, n: 0 },
  { e: 500, n: -250 },
  { e: 350, n: -270 },
]
const FAR = [
  { e: 5000, n: 5000 },
  { e: 5100, n: 5000 },
  { e: 5100, n: 4900 },
  { e: 5000, n: 4900 },
]
const at = (v: typeof A, dx: number, dy: number) => v.map((p) => ({ e: p.e + dx, n: p.n + dy }))
const turnAbout = (v: typeof A, deg: number) => {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return v.map((p) => ({ e: p.e * c + p.n * s, n: -p.e * s + p.n * c }))
}

describe('attaching an outline to one already placed', () => {
  it('slides a neighbour onto the line they share', () => {
    const s = snapToOutlines(at(B, 9000, 9000), [A])!
    expect(s.sharedFeet).toBeCloseTo(300, 0)
    s.vertices.forEach((p, i) => {
      expect(p.e).toBeCloseTo(B[i].e, 1)
      expect(p.n).toBeCloseTo(B[i].n, 1)
    })
  })
  it('also turns it, when its deed uses a slightly different meridian', () => {
    const s = snapToOutlines(at(turnAbout(B, 2.5), 9000, 9000), [A])!
    expect(Math.abs(s.rotation)).toBeCloseTo(2.5, 1)
    expect(s.vertices[0].e).toBeCloseTo(200, 0)
    expect(s.vertices[0].n).toBeCloseTo(0, 0)
  })
  it('will not attach an outline that shares no side with it', () => {
    expect(snapToOutlines(FAR, [A])).toBeNull()
  })
  it('will not attach by a side only part as long as the line: a shorter side could slide anywhere along it', () => {
    const shorter = [
      { e: 200, n: -100 },
      { e: 330, n: -100 },
      { e: 330, n: -250 },
      { e: 200, n: -250 },
    ]
    expect(snapToOutlines(at(shorter, 7000, 7000), [A])).toBeNull()
  })
  it('will not guess between two equally good attachments (equal sides fit either side of a neighbour)', () => {
    const lot = (x: number) => [
      { e: x, n: 0 },
      { e: x + 200, n: 0 },
      { e: x + 200, n: -300 },
      { e: x, n: -300 },
    ]
    expect(snapToOutlines(at(lot(0), 3000, 3000), [lot(0)])).toBeNull()
  })
  it('will not put one outline on top of another', () => {
    // a lot whose own sides all match the placed one, but placed over it
    expect(snapToOutlines(A, [A])).toBeNull()
  })
})

describe('placing every outline it can', () => {
  const pinsOn = (v: typeof A, n = 3) => v.slice(0, n).map((p, i) => ({ no: `p${i}`, e: p.e + 1000, n: p.n + 2000 }))
  it('places the one with pins, then attaches its neighbour, and leaves the stranger with a reason', () => {
    const r = placeAll(
      [
        { key: 'B', corners: at(B, 50000, 50000) },
        { key: 'A', corners: A },
        { key: 'FAR', corners: FAR },
      ],
      pinsOn(A),
    )
    const by = Object.fromEntries(r.map((x) => [x.key, x]))
    expect(by.A.how).toBe('pins')
    expect(by.B.how).toBe('shared line')
    expect(by.B.how === 'shared line' && by.B.withKey).toBe('A')
    expect(by.FAR).toMatchObject({ how: 'none' })
    if (by.B.how === 'shared line') expect(by.B.vertices[0].e).toBeCloseTo(B[0].e + 1000, 0)
  })
  it('chains: a neighbour of a neighbour attaches too', () => {
    const r = placeAll(
      [
        { key: 'C', corners: at(C, 8000, 8000) },
        { key: 'B', corners: at(B, 9000, 9000) },
        { key: 'A', corners: A },
      ],
      pinsOn(A),
    )
    expect(r.map((x) => x.how)).toEqual(['shared line', 'shared line', 'pins'])
    const c = r[0]
    if (c.how === 'shared line') expect(c.withKey).toBe('B')
  })
  it('never attaches a neighbour to an outline that failed its checks', () => {
    const items = [
      { key: 'A', corners: A, trusted: false },
      { key: 'B', corners: at(B, 9000, 9000) },
    ]
    const r = placeAll(items, pinsOn(A))
    expect(r[0].how).toBe('pins') // still placed, on the pins
    expect(r[1].how).toBe('none') // but B has nothing trusted to attach to
    // the same two with A trusted: B attaches
    expect(placeAll([{ key: 'A', corners: A }, items[1]], pinsOn(A))[1].how).toBe('shared line')
  })
  it('says why nothing could be placed when there are no pins at all', () => {
    const [r] = placeAll([{ key: 'A', corners: A }], [])
    expect(r).toMatchObject({ how: 'none', reason: expect.stringMatching(/too few found pins/) })
  })
})
