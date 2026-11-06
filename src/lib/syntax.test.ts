import { describe, expect, it } from 'vitest'
import { buildDictionary, matchDescription, splitDescription } from './codes.ts'
import { parseCodeBook } from './codebook.ts'
import { buildLinework } from './linework.ts'
import { DEFAULT_SYNTAX, SYNTAX_PRESETS, normalizeSyntax, presetIdOf, syntaxProblems } from './syntax.ts'
import type { LineworkSyntax } from './syntax.ts'
import type { CodeDef, SurveyPoint } from './types.ts'

const def = (code: string, layer: string, connect: boolean): CodeDef => ({ code, label: code, layer, connect })
const dict = buildDictionary([def('FN', 'V-FENCE', true), def('RD', 'V-ROAD', true), def('EP', 'V-EDGE', true), def('CC', 'V-PAD', true), def('XUP', 'V-POLE', false), def('GAS', 'V-GAS', false)])
const preset = (id: string) => SYNTAX_PRESETS.find((p) => p.id === id)!.syntax
const tdot = preset('tdot')
const words = preset('words')

const pts = (descs: string[], step = 500): SurveyPoint[] => descs.map((d, i) => ({ no: String(i + 1), e: i * step, n: (i % 2) * step, z: 0, desc: d, line: i + 1 }))
const build = (descs: string[], syntax: LineworkSyntax, step?: number) => {
  const p = pts(descs, step)
  return buildLinework(p, p.map((x) => matchDescription(x.desc, dict, syntax)), dict, { maxGap: 100, maxSkip: 0, explicitLines: syntax.explicitLines })
}

describe('syntax model', () => {
  it('fills in defaults and tidies values', () => {
    expect(normalizeSyntax(undefined)).toEqual(DEFAULT_SYNTAX)
    const s = normalizeSyntax({ begin: [' b ', 'B', 'two words', ''], separator: ';', endPrefix: '  -  ' })
    expect(s.begin).toEqual(['B'])
    expect(s.separator).toBe(';')
    expect(s.endPrefix).toBe('-')
  })
  it('refuses combinations that make descriptions ambiguous', () => {
    expect(syntaxProblems(normalizeSyntax({ separator: '/', descriptorDelimiter: '/' }))).toHaveLength(1)
    expect(syntaxProblems(normalizeSyntax({ begin: ['X'], end: ['X'] }))).toHaveLength(1)
    expect(syntaxProblems(DEFAULT_SYNTAX)).toEqual([])
  })
  it('every preset is valid and recognised, and a tweak makes it custom', () => {
    for (const p of SYNTAX_PRESETS) {
      expect(syntaxProblems(p.syntax)).toEqual([])
      expect(presetIdOf(p.syntax)).toBe(p.id)
    }
    expect(presetIdOf({ ...tdot, beginPrefix: '#' })).toBeNull()
  })
  it('ignores an unusable syntax in a file, with a warning', () => {
    const res = parseCodeBook({ format: 'terraforge-codebook', version: 1, codes: [], syntax: { separator: '=', descriptorDelimiter: '=' } })
    expect(res.ok && res.book.syntax).toBeUndefined()
    expect(res.ok && res.warnings).toHaveLength(1)
    expect(parseCodeBook({ format: 'terraforge-codebook', version: 1, codes: [], syntax: 'nope' }).ok && 'x').toBe('x')
  })
})

describe('reading descriptions under different conventions', () => {
  it('this job: "/" separates codes', () => {
    expect(splitDescription('GUTTER/EP/GAS', dict)).toEqual(['GUTTER', 'EP', 'GAS'])
  })
  it('TDOT: no separator, "=" starts a free-text descriptor that is never read as codes', () => {
    expect(matchDescription('XUP=P/T/C', dict, tdot)).toMatchObject({ codes: ['XUP'], unknown: [] })
    expect(splitDescription('+RD=MAIN ST. (ASP.)', dict, tdot)).toEqual(['+RD'])
  })
  it('a marker before a code applies to that code only, and needs a letter after it', () => {
    expect(matchDescription('+FN', dict, tdot)).toMatchObject({ codes: ['FN'], controls: { FN: { begin: true } } })
    expect(matchDescription('-FN', dict, tdot).controls).toEqual({ FN: { end: true } })
    expect(matchDescription('*FN', dict, tdot).controls).toEqual({ FN: { close: true } })
    expect(matchDescription('-5.0', dict, tdot).controls).toEqual({}) // a number, not an end marker
    expect(matchDescription('FN', dict, tdot).controls).toEqual({})
  })
  it('words style: "EP1 B", numbers name the line, B/E/C are whole words', () => {
    const m = matchDescription('EP1 B', dict, words)
    expect(m).toMatchObject({ codes: ['EP'], begin: true, lineIds: { EP: '1' } })
    expect(matchDescription('EP1 E', dict, words).end).toBe(true)
    expect(matchDescription('CC C', dict, words)).toMatchObject({ codes: ['CC'], close: true })
    expect(matchDescription('BC', dict, words).begin).toBe(false) // "B" inside a longer word is not a marker
  })
  it('a dictionary code wins over a marker word of the same spelling', () => {
    const own = buildDictionary([def('B', 'V-X', false), def('EP', 'V-EDGE', true)])
    expect(matchDescription('B', own, words)).toMatchObject({ codes: ['B'], begin: false })
  })
})

describe('explicit lines (TDOT style)', () => {
  const len = (ls: ReturnType<typeof build>) => ls.map((l) => l.vertices.length)
  it('+FN … FN … -FN is one line', () => {
    expect(len(build(['+FN', 'FN', 'FN', '-FN'], tdot))).toEqual([4])
  })
  it('*FN closes the figure', () => {
    const ls = build(['+FN', 'FN', 'FN', '*FN'], tdot)
    expect(ls).toHaveLength(1)
    expect(ls[0].closed).toBe(true)
  })
  it('several lines can be open at once, across long gaps and any number of other shots', () => {
    const ls = build(['+RD', '+FN', 'RD', 'FN', 'RD', 'FN', '-RD', '-FN'], tdot, 5000)
    expect(ls.map((l) => [l.layer, l.vertices.length]).sort()).toEqual([['V-FENCE', 4], ['V-ROAD', 4]])
  })
  it('the same code can be reused once its line has ended', () => {
    expect(len(build(['+FN', 'FN', '-FN', '+FN', 'FN', '-FN'], tdot))).toEqual([3, 3])
  })
  it('a new begin marker restarts the line', () => {
    expect(len(build(['+FN', 'FN', '+FN', 'FN', '-FN'], tdot))).toEqual([2, 3])
  })
  it('shots with no marker and no open line stay points', () => {
    expect(build(['FN', 'FN', 'FN'], tdot)).toEqual([])
    expect(build(['-FN', 'FN', 'FN'], tdot)).toEqual([])
  })
  it('symbols (no line) and descriptors do not draw lines', () => {
    expect(build(['XUP=P/T/C', 'XUP=P/T/C'], tdot)).toEqual([])
    expect(len(build(['+RD=MAIN ST. (ASP.)', 'RD', '-RD'], tdot))).toEqual([3])
  })
  it('without explicit mode the same markers are only hints and the old rules apply (gap, discipline)', () => {
    const inferred = { ...tdot, explicitLines: false }
    expect(build(['+FN', 'FN', 'FN', '-FN'], inferred, 500)).toEqual([]) // 500 apart: more than the gap
  })
})

describe('explicit lines (Civil 3D / BLM word style)', () => {
  it('EP1 B … EP1 E, with a second figure open at the same time', () => {
    const ls = build(['EP1 B', 'EP2 B', 'EP1', 'EP2', 'EP1 E', 'EP2 E'], words, 3000)
    expect(ls.map((l) => l.vertices.length)).toEqual([3, 3])
    expect(new Set(ls.map((l) => l.key)).size).toBe(2)
  })
  it('BLM: CC B, CC, CC, CC C closes a pad', () => {
    const ls = build(['CC B', 'CC', 'CC', 'CC C'], words)
    expect(ls).toHaveLength(1)
    expect(ls[0].closed).toBe(true)
    expect(ls[0].layer).toBe('V-PAD')
  })
})
