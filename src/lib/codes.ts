import starterJson from '../data/starter-codes.json' with { type: 'json' }
import { parseCodeBook } from './codebook.ts'
import { DEFAULT_SYNTAX } from './syntax.ts'
import type { LineworkSyntax } from './syntax.ts'
import type { CodeBook } from './codebook.ts'
import type { CodeDef, LayerDef, PointMatch } from './types.ts'

/** Layers always present in the output. */
export const POINT_LAYERS: LayerDef[] = [
  { name: 'PNTS', aci: 1, label: 'Point markers' },
  { name: 'PNTNO', aci: 7, label: 'Point numbers' },
  { name: 'PNTELEV', aci: 5, label: 'Elevations' },
  { name: 'PNTDESC', aci: 3, label: 'Descriptions' },
]

/** Layers for drawn annotations (bearings and distances); not tied to any code. */
export const ANNOTATION_LAYERS: LayerDef[] = [{ name: 'BRGTXT', aci: 7, label: 'Bearings and distances' }]

export const MISC_LAYER = 'V-NODE'

/**
 * The starter code book lives in src/data/starter-codes.json so it is data, not code: a surveyor
 * can export it, edit it, and import their own. Layer names and colours come from the reference
 * drawing (reference/DXF-NOTES.md); the code meanings are a best reading of one sample job and still
 * need surveyor review (PROJECT.md). `connect` defaults were tuned against that job's finished drawing.
 */
const starter = parseCodeBook(starterJson)
if (!starter.ok) throw new Error('src/data/starter-codes.json is invalid: ' + starter.errors.join('; '))

export const STARTER_BOOK: CodeBook = starter.book
export const STARTER_CODES: CodeDef[] = STARTER_BOOK.codes
export const LAYERS: LayerDef[] = STARTER_BOOK.layers
export const DEFAULT_MAX_GAP = STARTER_BOOK.maxGap ?? 100
/** Line discipline: 0 = a line runs only through shots taken one after another. */
export const DEFAULT_MAX_SKIP = STARTER_BOOK.maxSkip ?? 0
/** Drop line segments that cross other lines. */
export const DEFAULT_AVOID_CROSSINGS = STARTER_BOOK.avoidCrossings ?? true
/** Join leftover nearby points of the same layer, up to this distance (0 = off). */
export const DEFAULT_FILL_GAPS = STARTER_BOOK.fillGaps ?? 0
/** Lines do not double back sharper than this many degrees (0 = off). */
export const DEFAULT_MIN_TURN = STARTER_BOOK.minTurn ?? 0

/** Longest first, so "CLOSE" is not read as "CLO" + "SE". Words are whole words only. */
function wordRegex(words: string[]): RegExp | null {
  if (words.length === 0) return null
  const alt = [...words].sort((x, y) => y.length - x.length).map(escapeRe).join('|')
  return new RegExp(`(?<![A-Z0-9])(?:${alt})(?![A-Z0-9])`, 'g')
}

/** `3'O/S`, `3' O/S`, `1.5'OS`: an offset shot. */
const OFFSET_RE = /^\d+(\.\d+)?\s*'?\s*O\/?S\b/
/**
 * "CONC 2'OFF BLDG", "BOC 1.5'OFF HSE": a shot annotated with its distance from a structure. It is a measurement note, not a
 * point on a line, so it keeps its code (and layer) but is never joined into linework. The drafter joined none of these on the
 * sample job (5 of 5 segments touching one were wrong).
 */
const OFF_NOTE_RE = /\d+(?:\.\d+)?\s*'\s*OFF\b/

export type Dictionary = Map<string, CodeDef>

export function buildDictionary(defs: CodeDef[]): Dictionary {
  return new Map(defs.map((def) => [normalize(def.code), def]))
}

export function normalize(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim()
}

/**
 * Split a description into code tokens on the syntax's separator ("/" by default), except where the
 * separator is part of a code (`O/S`, `C/L`, or any dictionary key containing it). Anything after the
 * descriptor marker ("=" in TDOT's style) is free text, not codes.
 */
export function splitDescription(desc: string, dict?: Dictionary, syntax: LineworkSyntax = DEFAULT_SYNTAX): string[] {
  let work = normalize(desc)
  if (syntax.descriptorDelimiter) {
    const i = work.indexOf(syntax.descriptorDelimiter)
    if (i >= 0) work = work.slice(0, i).trim()
  }
  const sep = syntax.separator
  if (sep === '') return work === '' ? [] : [work]

  const protect = sep === '/' ? ['O/S', 'C/L'] : []
  if (dict) for (const k of dict.keys()) if (k.includes(sep)) protect.push(k)
  const placeholders: string[] = []
  for (const key of protect) {
    const re = new RegExp(`(?<![A-Z0-9])${escapeRe(key)}`, 'g')
    work = work.replace(re, (m) => {
      placeholders.push(m)
      return `\u0001${placeholders.length - 1}\u0001`
    })
  }
  return work
    .split(sep)
    // oxlint-disable-next-line no-control-regex -- \u0001 is our private placeholder marker
    .map((t) => t.replace(/\u0001(\d+)\u0001/g, (_, i: string) => placeholders[Number(i)]).trim())
    .filter((t) => t !== '')
}

/** Find the dictionary key for one token: exact, else the longest key it starts with. */
export function lookupToken(token: string, dict: Dictionary): string | null {
  if (dict.has(token)) return token
  let best: string | null = null
  for (const key of dict.keys()) {
    if (!token.startsWith(key)) continue
    const next = token.charAt(key.length)
    // "IPF#1670" and "BOC 1.5'OFF HSE" match; "IPFX" does not.
    if (next !== '' && /[A-Z]/.test(next)) continue
    if (best === null || key.length > best.length) best = key
  }
  return best
}

export function matchDescription(desc: string, dict: Dictionary, syntax: LineworkSyntax = DEFAULT_SYNTAX): PointMatch {
  const match: PointMatch = { codes: [], unknown: [], offset: false, end: false, begin: false, close: false, lineIds: {}, controls: {} }
  const beginW = new Set(syntax.begin)
  const endW = new Set(syntax.end)
  const wordRe = wordRegex([...syntax.begin, ...syntax.end, ...syntax.close])
  const prefixes: Array<['begin' | 'end' | 'close', string]> = [
    ['begin', syntax.beginPrefix],
    ['end', syntax.endPrefix],
    ['close', syntax.closePrefix],
  ]

  for (const raw of splitDescription(desc, dict, syntax)) {
    let token = raw
    let attached: 'begin' | 'end' | 'close' | null = null
    if (!dict.has(token)) {
      // A marker written straight before a code ("+FN", "-FN", "*FN") applies to that code only.
      // It must be followed by a letter, digit or "?", so "-5" or "*" alone are not markers.
      for (const [kind, prefix] of prefixes) {
        if (prefix !== '' && token.startsWith(prefix) && /^[A-Z0-9?]/.test(token.slice(prefix.length))) {
          attached = kind
          token = token.slice(prefix.length).trim()
          break
        }
      }
      // Control words steer linework and are recognised as whole words anywhere in a token
      // ("EP BEG", "EP1 B"), unless the dictionary defines the word as a code of its own.
      if (wordRe) {
        token = token
          .replace(wordRe, (word) => {
            if (dict.has(word)) return word
            if (endW.has(word)) match.end = true
            else if (beginW.has(word)) match.begin = true
            else match.close = true
            return ' '
          })
          .replace(/\s+/g, ' ')
          .trim()
      }
      if (token === '') continue
    }
    if (OFFSET_RE.test(token)) {
      match.offset = true
      continue
    }
    if (OFF_NOTE_RE.test(token)) match.offset = true // keep the code, but do not join it into a line
    const key = lookupToken(token, dict)
    if (key === null) {
      if (!match.unknown.includes(token)) match.unknown.push(token)
    } else {
      if (!match.codes.includes(key)) {
        match.codes.push(key)
        // "BLDG2", "EP 3": a number straight after the code names which line this shot belongs to.
        const suffix = /^\s?(\d+)$/.exec(token.slice(key.length))
        if (suffix) match.lineIds[key] = suffix[1]
      }
      if (attached) match.controls[key] = { ...match.controls[key], [attached]: true }
    }
  }
  return match
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
