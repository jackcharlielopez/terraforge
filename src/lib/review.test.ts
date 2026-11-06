import { describe, expect, it } from 'vitest'
import { EMPTY_EDITS, applyEdits, buildReviewExport, edgeKey, fingerprint, guessedEdges, segmentsOf } from './review.ts'
import type { Polyline, SurveyPoint } from './types.ts'

const P = (no: number, e: number, n: number, desc = 'EP'): SurveyPoint => ({ no: String(no), e, n, z: 1, desc, line: no })
const pts = [P(1, 1000, 2000), P(2, 1010, 2000), P(3, 1020, 2000), P(4, 1030, 2005)]
const line = (idx: number[], layer = 'L', extra: Partial<Polyline> = {}): Polyline => ({
  layer,
  key: 'k',
  closed: false,
  vertices: idx.map((i) => ({ e: pts[i].e, n: pts[i].n, z: 1 })),
  ...extra,
})

describe('segments', () => {
  it('lists every segment between two survey points, with the closing one', () => {
    expect(segmentsOf(pts, [line([0, 1, 2])]).map((s) => s.key)).toEqual(['0-1', '1-2'])
    expect(segmentsOf(pts, [line([0, 1, 2], 'L', { closed: true })]).map((s) => s.key)).toEqual(['0-1', '1-2', '0-2'])
  })
  it('names an edge the same whichever way round it is written', () => {
    expect(edgeKey(5, 2)).toBe(edgeKey(2, 5))
  })
})

describe('applying the drafter\'s changes', () => {
  it('returns the same lines when nothing was changed', () => {
    const lines = [line([0, 1, 2])]
    expect(applyEdits(pts, lines, EMPTY_EDITS)).toBe(lines)
  })
  it('removes a rejected segment and splits the line around it', () => {
    const out = applyEdits(pts, [line([0, 1, 2, 3])], { ...EMPTY_EDITS, rejected: [edgeKey(1, 2)] })
    expect(out.map((l) => l.vertices.length)).toEqual([2, 2])
    expect(segmentsOf(pts, out).map((s) => s.key)).toEqual(['0-1', '2-3'])
  })
  it('appends an added line on the chosen layer, and keeps it out of crossing removal', () => {
    const out = applyEdits(pts, [line([0, 1])], { ...EMPTY_EDITS, added: [{ a: 1, b: 3, layer: 'NEW' }] })
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ layer: 'NEW', key: 'drafter', mayCross: true })
    expect(segmentsOf(pts, out).map((s) => s.key)).toContain('1-3')
  })
})

describe('which segments are guesses', () => {
  it('is the segments in the drawing that the rules alone did not make', () => {
    const baseline = [line([0, 1]), line([2, 3])]
    const final = [line([0, 1, 2, 3])] // the guessing step joined 1 and 2
    expect([...guessedEdges(pts, final, baseline)]).toEqual(['1-2'])
  })
})

describe('the exported log', () => {
  const matches = pts.map(() => ({ codes: ['EP'], unknown: [], offset: false, end: false, begin: false, close: false, lineIds: {}, controls: {} }))
  const seg = (a: number, b: number) => ({ a, b, key: edgeKey(a, b), layer: 'L', lineKey: 'k' })
  const log = buildReviewExport({
    points: pts,
    matches,
    settings: { maxGap: 100 },
    generated: [seg(0, 1), seg(1, 2)],
    final: [seg(0, 1), seg(1, 3)],
    guessed: new Set([edgeKey(1, 2)]),
    added: new Set([edgeKey(1, 3)]),
    events: [{ t: 1, type: 'reject', a: '2', b: '3', layer: 'L', source: 'guess' }],
  })
  it('keeps positions relative to the middle of the job, not where it is', () => {
    expect(log.points.every((p) => Math.abs(p.e) < 20 && Math.abs(p.n) < 5)).toBe(true)
    expect(JSON.stringify(log)).not.toContain('1000')
    expect(log.points.map((p) => p.no)).toEqual(['1', '2', '3', '4'])
  })
  it('says where each generated and final segment came from', () => {
    expect(log.generated.map((s) => s.source)).toEqual(['rule', 'guess'])
    expect(log.final.map((s) => s.source)).toEqual(['rule', 'manual'])
  })
  it('gives the same fingerprint for the same points and a different one when a point moves', () => {
    expect(fingerprint(pts)).toBe(fingerprint([...pts]))
    expect(fingerprint(pts)).not.toBe(fingerprint([...pts.slice(0, 3), P(4, 1031, 2005)]))
  })
})
