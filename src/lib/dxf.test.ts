import { readFileSync } from 'node:fs'
import DxfParser from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { STARTER_CODES, buildDictionary, matchDescription } from './codes.ts'
import { buildDxf } from './dxf.ts'
import { buildLinework } from './linework.ts'
import { parsePoints } from './parse.ts'

const dict = buildDictionary(STARTER_CODES)
const { points } = parsePoints(readFileSync('samples/job-a.txt', 'latin1'))
const matches = points.map((p) => matchDescription(p.desc, dict))
const lines = buildLinework(points, matches, dict)
const dxf = buildDxf(points, matches, dict, lines)
const parsed = new DxfParser().parseSync(dxf)!
const ents = parsed.entities as Array<{ type: string; layer: string; position?: { x: number; y: number; z: number }; vertices?: unknown[]; text?: string }>
const onLayer = (type: string, layer: string) => ents.filter((e) => e.type === type && e.layer === layer)

describe('buildDxf', () => {
  it('produces a file a DXF parser accepts, R12 with CRLF', () => {
    expect(dxf.startsWith('  0\r\nSECTION')).toBe(true)
    expect(dxf).toContain('AC1009')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
  })

  it('writes every point as a circle + POINT on PNTS, with true Z', () => {
    expect(onLayer('POINT', 'PNTS')).toHaveLength(points.length)
    expect(onLayer('CIRCLE', 'PNTS')).toHaveLength(points.length)
    const p0 = onLayer('POINT', 'PNTS')[0].position!
    expect(p0).toMatchObject({ x: 1943809.323, y: 431626.252, z: 1063.688 })
  })

  it('writes number, elevation and description labels on their own layers', () => {
    expect(onLayer('TEXT', 'PNTNO')).toHaveLength(points.length)
    expect(onLayer('TEXT', 'PNTELEV')).toHaveLength(points.length)
    expect(onLayer('TEXT', 'PNTDESC')).toHaveLength(points.length)
    expect(onLayer('TEXT', 'PNTDESC').some((t) => t.text === 'IE 12"PIPE')).toBe(true)
  })

  it('writes the connected runs as polylines on their feature layers', () => {
    const polys = ents.filter((e) => e.type === 'POLYLINE')
    expect(polys).toHaveLength(lines.length)
    expect(lines.length).toBeGreaterThan(0)
    expect(new Set(polys.map((e) => e.layer))).toContain('V-DTCH-TOPD')
  })

  it('declares a LAYER table entry for every layer it uses', () => {
    const declared = new Set(Object.keys(parsed.tables.layer.layers))
    for (const e of ents) expect(declared.has(e.layer)).toBe(true)
  })

  it('leaves out hidden layers', () => {
    const out = buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 0.5, hiddenLayers: new Set(['PNTDESC', 'V-DTCH-TOPD']) })
    const p = new DxfParser().parseSync(out)!
    expect((p.entities as Array<{ layer: string }>).some((e) => e.layer === 'PNTDESC' || e.layer === 'V-DTCH-TOPD')).toBe(false)
  })

  it('matches the reference drawing: same point positions on PNTS', () => {
    const ref = new DxfParser().parseSync(readFileSync('reference/job-a.dxf', 'latin1'))!
    const refPts = (ref.entities as typeof ents).filter((e) => e.type === 'POINT' && e.layer === 'PNTS')
    const key = (e: { position?: { x: number; y: number; z: number } }) =>
      `${e.position!.x.toFixed(3)},${e.position!.y.toFixed(3)},${e.position!.z.toFixed(3)}`
    expect(refPts.length).toBeGreaterThan(190)
    const mine = new Set(onLayer('POINT', 'PNTS').map(key))
    const theirs = new Set(refPts.map(key))
    // The drafter added 3 control points and moved point 148 to another layer; everything else must match.
    const missing = [...mine].filter((k) => !theirs.has(k))
    expect(missing.length).toBeLessThanOrEqual(1)
    expect([...theirs].filter((k) => !mine.has(k)).length).toBeLessThanOrEqual(3)
  })
})
