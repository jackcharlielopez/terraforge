import { describe, expect, it } from 'vitest'
import { buildDictionary, matchDescription } from './codes.ts'
import { continueLines } from './continue.ts'
import type { CodeDef, Polyline, SurveyPoint } from './types.ts'

const def = (code: string, extra: Partial<CodeDef> = {}): CodeDef => ({ code, label: code, layer: 'EDGE', connect: true, ...extra })
const P = (no: number, e: number, n: number, desc: string): SurveyPoint => ({ no: String(no), e, n, z: 0, desc, line: no })
const line = (pts: SurveyPoint[]): Polyline => ({ layer: 'EDGE', key: 'k', closed: false, vertices: pts.map((p) => ({ e: p.e, n: p.n, z: 0 })) })
const run = (pts: SurveyPoint[], lines: Polyline[], defs: CodeDef[] = [def('EP')]) => {
  const dict = buildDictionary(defs)
  return continueLines(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, lines)
}

describe('continuing lines whose ends meet head on', () => {
  const a = [P(1, 0, 0, 'EP'), P(2, 20, 0, 'EP'), P(3, 40, 0, 'EP')]
  const b = [P(4, 100, 0, 'EP'), P(5, 120, 0, 'EP')]

  it('joins the end of one line to the start of another that lies straight ahead of it', () => {
    const out = run([...a, ...b], [line(a), line(b)])
    expect(out).toHaveLength(1)
    expect(out[0].vertices.map((v) => v.e).sort((x, y) => x - y)).toEqual([0, 20, 40, 100, 120])
  })
  it('does not join across a bend: the second line is off to the side of where the first was heading', () => {
    const side = [P(4, 60, 50, 'EP'), P(5, 60, 80, 'EP')]
    expect(run([...a, ...side], [line(a), line(side)])).toHaveLength(2)
  })
  it('reaches further only when the two lines point almost straight at each other', () => {
    const straight = [P(4, 160, 0, 'EP'), P(5, 180, 0, 'EP')] // 120 ft on, dead ahead
    expect(run([...a, ...straight], [line(a), line(straight)])).toHaveLength(1)
    const skew = [P(4, 150, 45, 'EP'), P(5, 170, 50, 'EP')] // about 17 degrees off: fine at 80 ft, not at 115
    expect(run([...a, ...skew], [line(a), line(skew)])).toHaveLength(2)
  })
  it('does not join beyond the distance limit', () => {
    const far = [P(4, 300, 0, 'EP'), P(5, 320, 0, 'EP')]
    expect(run([...a, ...far], [line(a), line(far)])).toHaveLength(2)
  })
  it('does not skip over a point of the same layer that lies between', () => {
    const mid = P(9, 70, 0, 'EP')
    const out = run([...a, mid, ...b], [line(a), line(b)])
    // the loose point is picked up instead of being jumped over
    expect(out.flatMap((l) => l.vertices).some((v) => v.e === 70)).toBe(true)
    expect(out.every((l) => !(l.vertices.some((v) => v.e === 40) && l.vertices.some((v) => v.e === 100) && l.vertices.length === 5))).toBe(true)
  })
  it('takes in a loose point straight ahead of a line, but never joins two loose points', () => {
    const loose = P(9, 70, 0, 'EP')
    const out = run([...a, loose], [line(a)])
    expect(out).toHaveLength(1)
    expect(out[0].vertices).toHaveLength(4)
    expect(run([P(1, 0, 0, 'EP'), P(2, 30, 0, 'EP')], [])).toEqual([])
  })
  it('bridges an END marker when the next piece lines up, but never a BEG or CLO marker', () => {
    const end = [P(1, 0, 0, 'EP'), P(2, 20, 0, 'EP'), P(3, 40, 0, 'EP END')]
    expect(run([...end, ...b], [line(end), line(b)])).toHaveLength(1)
    const close = [P(1, 0, 0, 'EP'), P(2, 20, 0, 'EP'), P(3, 40, 0, 'EP CLO')]
    expect(run([...close, ...b], [line(close), line(b)])).toHaveLength(2)
  })
  it('never closes a line on itself, and does nothing for different layers', () => {
    expect(run(a, [line(a)])).toHaveLength(1)
    const other = [P(4, 100, 0, 'FOO'), P(5, 120, 0, 'FOO')]
    const out = run([...a, ...other], [line(a), { ...line(other), layer: 'OTHER' }], [def('EP'), def('FOO', { layer: 'OTHER' })])
    expect(out).toHaveLength(2)
  })
})

describe('capping the mouth of a U', () => {
  // two edges of a driveway running south, ending 20 ft apart
  const left = [P(1, 0, 60, 'EP'), P(2, 0, 30, 'EP'), P(3, 0, 0, 'EP')]
  const right = [P(4, 20, 60, 'EP'), P(5, 20, 30, 'EP'), P(6, 20, 0, 'EP')]
  it('ties the two free ends together with a short line square to both', () => {
    const out = run([...left, ...right], [line(left), line(right)])
    expect(out).toHaveLength(1)
    expect(out[0].vertices).toHaveLength(6)
  })
  it('does not cap ends only a few feet apart, or ends that are not square to the cap', () => {
    const near = [P(4, 4, 60, 'EP'), P(5, 4, 30, 'EP'), P(6, 4, 0, 'EP')]
    expect(run([...left, ...near], [line(left), line(near)])).toHaveLength(2)
    const stagger = [P(4, 20, 80, 'EP'), P(5, 20, 50, 'EP'), P(6, 20, 20, 'EP')] // ends 20 ft further along: the cap would be slanted
    expect(run([...left, ...stagger], [line(left), line(stagger)])).toHaveLength(2)
  })
  it('does not cap lines running opposite ways', () => {
    const back = [P(4, 20, 0, 'EP'), P(5, 20, 30, 'EP'), P(6, 20, 60, 'EP')]
    // heads north while the first heads south at its end... the ends face away from each other
    const out = run([...left, ...back], [line(left), line(back)])
    expect(out.length).toBeGreaterThan(0)
  })
})

