import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchDescription } from './codes.ts'
import { buildLinework } from './linework.ts'
import { parsePoints } from './parse.ts'
import { classifyDescription, deriveRules } from './rules.ts'
import type { CodeDef, SurveyPoint } from './types.ts'

const P = (no: number, e: number, n: number, desc: string): SurveyPoint => ({ no: String(no), e, n, z: 0, desc, line: no })
const layerOf = (token: string, shots = 5) => classifyDescription(token, shots)?.def.layer ?? null

describe('what a description means, from its words', () => {
  it('leaves stakes, posts, flagging, monuments and corners as points', () => {
    for (const t of ['STK', 'WD STAKE', 'TPOST', 'ORANGE TPOST', 'TPOST IN FENCE', 'FLAGGING IN TREE', 'NAIL FOUND', 'IPF BY WD FENCE CRNR', 'CONCRETE MONUMENT', 'GUY']) {
      expect(classifyDescription(t, 9), t).toBeNull()
    }
  })
  it('puts every fence wording on one fence layer and one line', () => {
    const a = classifyDescription('FENCE BARB OLD', 3)!.def
    const b = classifyDescription('WH OAK FENCE BARB OLD', 3)!.def
    expect(a.layer).toBe('V-SITE-FENC')
    expect(b.layer).toBe('V-SITE-FENC')
    expect(a.line).toBe(b.line)
  })
  it('reads "CL ..." as a centreline, and lets a road suffix beat a stream word in the road\'s name', () => {
    expect(layerOf('CL SMITH-JONES RD')).toBe('V-ROAD-CNTR')
    expect(layerOf('CL FOX BRANCH RD')).toBe('V-ROAD-CNTR') // BRANCH is part of the road's name
    expect(layerOf('CL BRANCH')).toBe('V-STRM-CNTR')
    expect(layerOf('CL CREEK')).toBe('V-STRM-CNTR')
    expect(layerOf('CL OLD RD')).toBe('V-ROAD-CNTR')
  })
  it('does not draw a driveway centreline', () => {
    expect(layerOf('CL ASPHALT DW')).toBeNull()
    expect(layerOf('CL DW')).toBeNull()
  })
  it('groups tree lines, field edges, paths, power and buildings', () => {
    expect(layerOf('TREE LINE')).toBe('V-TREE-LINE')
    expect(layerOf('EDGE OF FIELD')).toBe('V-TREE-LINE')
    expect(classifyDescription('TREE LINE', 3)!.def.line).toBe(classifyDescription('EDGE OF FIELD', 3)!.def.line)
    expect(layerOf('FIELD PATH')).toBe('V-ROAD-TRAL')
    expect(classifyDescription('PP', 3)!.def).toMatchObject({ layer: 'V-POWR-OVHD', mayCross: true })
    expect(classifyDescription('HC', 4)!.def).toMatchObject({ layer: 'V-BLDG-OTLN', closed: true })
  })
  it('makes any other description used twice or more a line of its own, and leaves a one-off or a marker as a point', () => {
    expect(classifyDescription('POND', 12)!.def).toMatchObject({ connect: true, layer: 'V-LINE-POND', line: 'POND' })
    expect(classifyDescription('POND', 1)).toBeNull()
    expect(classifyDescription('X', 17)).toBeNull()
    expect(classifyDescription('EG', 9)).toBeNull()
  })
  it('gives these lines room: shots of a fence or tree line are far apart and other shots sit between them', () => {
    expect(classifyDescription('POND', 12)!.def).toMatchObject({ maxGap: 400, maxSkip: 8 })
  })
})

describe('deriveRules', () => {
  const pts = [P(1, 0, 0, 'TREE LINE'), P(2, 100, 0, 'TREE LINE'), P(3, 200, 0, 'TREE LINE'), P(4, 0, 50, 'STK'), P(5, 50, 50, 'EP'), P(6, 90, 50, 'EP')]
  it('keeps the built-in codes, adds the layers a job needs, and leaves a stake a point', () => {
    const { dict, layers } = deriveRules(pts)
    expect(dict.get('EP')?.layer).toBe('V-ROAD-ASPH') // built-in knowledge is untouched
    expect(dict.get('TREE LINE')?.layer).toBe('V-TREE-LINE')
    expect(dict.has('STK')).toBe(false)
    expect(layers.some((l) => l.name === 'V-TREE-LINE')).toBe(true)
  })
  it('draws the lines the rules found, with no dictionary at all', () => {
    const { dict } = deriveRules(pts)
    const lines = buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict)
    expect(lines.find((l) => l.layer === 'V-TREE-LINE')?.vertices).toHaveLength(3)
  })
  it('lets a smarter classifier (an AI model) overrule a rule, or keep a description a point', () => {
    const asPoint = deriveRules(pts, new Map<string, CodeDef | null>([['TREE LINE', null]]))
    expect(asPoint.dict.has('TREE LINE')).toBe(false)
    const custom: CodeDef = { code: 'TREE LINE', label: 'Hedge', layer: 'V-HEDGE', connect: true }
    const used = deriveRules(pts, new Map([['TREE LINE', custom]]))
    expect(used.dict.get('TREE LINE')?.layer).toBe('V-HEDGE')
    expect(used.layers.some((l) => l.name === 'V-HEDGE')).toBe(true)
  })
  it('hands out different colours to the layers it creates', () => {
    const many = Array.from({ length: 6 }, (_, k) => [P(10 * k + 1, 0, k, `THING${k}`), P(10 * k + 2, 10, k, `THING${k}`)]).flat()
    const { layers } = deriveRules(many)
    const made = layers.filter((l) => l.name.startsWith('V-LINE-THING'))
    expect(made).toHaveLength(6)
    expect(new Set(made.map((l) => l.aci)).size).toBe(6)
  })
})

describe('a job the built-in codes already fit is left alone', () => {
  it('adds nothing that connects on the sample job', () => {
    const points = parsePoints(readFileSync('samples/job-a.txt', 'latin1')).points
    const { dict } = deriveRules(points)
    const added = [...dict.values()].filter((d) => d.maxSkip === 8 && d.line === d.code && d.layer.startsWith('V-LINE-'))
    expect(added).toEqual([]) // X, EG, STK and one-offs stay points
  })
})
