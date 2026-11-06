import { readFileSync } from 'node:fs'
import DxfParser from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { STARTER_CODES, buildDictionary, matchDescription } from './codes.ts'
import { SCRAMBLED_BELOW, orderliness } from './gapfill.ts'
import { countCrossings, removeCrossings } from './geometry.ts'
import { DEFAULT_LINEWORK, buildLinework } from './linework.ts'
import { parsePoints } from './parse.ts'

/**
 * Scores the default linework against the drafter's finished drawing: how many of the
 * drafter's segments between two survey points we reproduce, and how many of ours they also drew.
 * The thresholds are a floor set just under today's result (see PROJECT.md), so tuning that makes
 * the output worse fails here. Raise them as the linework improves.
 */
const points = parsePoints(readFileSync('samples/job-a.txt', 'latin1')).points
const dict = buildDictionary(STARTER_CODES)
const matches = points.map((p) => matchDescription(p.desc, dict))
const raw = buildLinework(points, matches, dict, DEFAULT_LINEWORK)
// The same steps the app takes by default: build the lines, then leave out segments that cross.
const mine = removeCrossings(raw).lines

const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`
const edge = (a: string, b: string) => [a, b].sort().join('|')
const ptKeys = new Set(points.map((p) => key(p.e, p.n)))

type Ent = { type: string; layer: string; shape?: boolean; vertices: Array<{ x: number; y: number }> }
const ref = new DxfParser().parseSync(readFileSync('reference/job-a.dxf', 'latin1'))!.entities as unknown as Ent[]

const refEdges = new Set<string>()
for (const e of ref) {
  if (e.layer === 'Text' || e.layer === 'LEGEND') continue
  const v = e.vertices?.map((p) => key(p.x, p.y)) ?? []
  if (e.type === 'LWPOLYLINE' || e.type === 'LINE') {
    v.slice(1).forEach((b, i) => refEdges.add(edge(v[i], b)))
    if (e.type === 'LWPOLYLINE' && e.shape && v.length > 2) refEdges.add(edge(v[v.length - 1], v[0]))
  }
}
const refPointEdges = new Set([...refEdges].filter((k) => k.split('|').every((p) => ptKeys.has(p))))

const myEdges = new Set<string>()
for (const l of mine) {
  const v = l.vertices.map((p) => key(p.e, p.n))
  v.slice(1).forEach((b, i) => myEdges.add(edge(v[i], b)))
  if (l.closed) myEdges.add(edge(v[v.length - 1], v[0]))
}
const correct = [...myEdges].filter((k) => refPointEdges.has(k)).length

describe('default linework vs the drafter\'s drawing', () => {
  it('reproduces most of the drafter\'s point-to-point segments', () => {
    expect(refPointEdges.size).toBeGreaterThan(90)
    expect(correct / refPointEdges.size).toBeGreaterThanOrEqual(0.74) // 77% today
  })
  it('does not draw many segments the drafter did not', () => {
    expect(correct / myEdges.size).toBeGreaterThanOrEqual(0.80) // 84% today
  })
  it('has no crossing lines (the drafter draws none between surface features; legal and utility lines excepted)', () => {
    expect(countCrossings(mine)).toBe(0)
  })
  it('would have many crossings without the removal step: this is what the step is for', () => {
    expect(countCrossings(raw)).toBeGreaterThan(0) // 1 today with the ditch drawn from its points (4 with banks only, 9 before that, 25 without banks)
  })
})

/**
 * The same job with its point numbers scrambled (a fixed shuffle, so the test is repeatable). Shot order then means
 * nothing; the app should notice and join by position, which recovers a lot of what shot order loses.
 */
describe('a job whose numbers are scrambled', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const ranks = points.map((_, i) => i)
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[ranks[i], ranks[j]] = [ranks[j], ranks[i]]
  }
  const shuffled = points.map((p, i) => ({ ...p, no: String(1000 + ranks[i]) }))
  const sm = shuffled.map((p) => matchDescription(p.desc, dict))
  const found = (joinBy: 'order' | 'position') => {
    const lines = removeCrossings(buildLinework(shuffled, sm, dict, { ...DEFAULT_LINEWORK, joinBy })).lines
    const edges = new Set<string>()
    for (const l of lines) {
      const v = l.vertices.map((p) => key(p.e, p.n))
      v.slice(1).forEach((b, i) => edges.add(edge(v[i], b)))
      if (l.closed) edges.add(edge(v[v.length - 1], v[0]))
    }
    return [...edges].filter((k) => refPointEdges.has(k)).length / refPointEdges.size
  }

  it('is recognised as scrambled, while the real numbering is recognised as orderly', () => {
    expect(orderliness(shuffled, sm, dict)).toBeLessThan(SCRAMBLED_BELOW) // about 0.18
    expect(orderliness(points, matches, dict)).toBeGreaterThan(0.7) // 0.81
  })
  it('joining by position finds far more of the drafter\'s lines than shot order does', () => {
    expect(found('position')).toBeGreaterThan(found('order') + 0.03) // 48% against 41% (continuing line ends and a position-ordered ditch lifted shot order from 11%)
    expect(found('position')).toBeGreaterThan(0.4)
  })
})
