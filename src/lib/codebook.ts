import { nearestAci, normalizeHex } from './aci.ts'
import { isSymbol } from './symbols.ts'
import { normalizeSyntax, syntaxProblems } from './syntax.ts'
import type { LineworkSyntax } from './syntax.ts'
import type { CodeDef, LayerDef } from './types.ts'

/**
 * A "code book" is a surveyor's dictionary: which description codes mean what, which layer they
 * go on, and which ones to join into lines. It is a plain JSON file so a firm can keep one,
 * share it, and import it into TerraForge. The starter book (src/data/starter-codes.json) is
 * just one of these.
 *
 * File shape (version 1):
 *   { "format": "terraforge-codebook", "version": 1, "name": "...", "maxGap": 100, "maxSkip": 0, "avoidCrossings": true,
 *     "syntax": { "separator": "/", "descriptorDelimiter": "", "begin": ["BEG"], "end": ["END"], "close": ["CLO"],
 *                 "beginPrefix": "", "endPrefix": "", "closePrefix": "", "explicitLines": false },
 *     "layers": [{ "name": "V-PROP", "aci": 21, "hex": "#cc6644", "label": "..." }],  // aci or hex (or both)
 *     "codes":  [{ "code": "IPF", "label": "...", "layer": "V-PROP", "connect": false,
 *                  "line": "...", "closed": true, "maxGap": 400, "maxSkip": 8, "closeNumbered": true, "mayCross": true, "boundary": true, "alongside": "CLD" }] }
 */
export const CODEBOOK_FORMAT = 'terraforge-codebook'
export const CODEBOOK_VERSION = 1

export interface CodeBook {
  name: string
  codes: CodeDef[]
  layers: LayerDef[]
  /** Default gap limit for new lines; the app falls back to its own default when absent. */
  maxGap?: number
  /** Default line discipline: how many other shots may interrupt a line (0 = strict). */
  maxSkip?: number
  /** Drop line segments that cross other lines (default on). */
  avoidCrossings?: boolean
  /** Join leftover nearby points of the same layer by position, up to this distance (0 = off). */
  fillGaps?: number
  /** Drop the longer segment where two lines meet at a sharper angle than this, in degrees (0 = off). */
  minTurn?: number
  /** How this firm writes codes and marks lines; absent = the default (this job's) style. */
  syntax?: LineworkSyntax
}

export type CodeBookResult =
  | { ok: true; book: CodeBook; warnings: string[] }
  | { ok: false; errors: string[] }

/** DXF layer names may not contain these characters. */
const BAD_LAYER_CHARS = /[<>/\\":;?*|=`]/

export function parseCodeBook(raw: unknown): CodeBookResult {
  if (!isObject(raw)) return fail('Expected a JSON object at the top level.')
  if (raw.format !== CODEBOOK_FORMAT) return fail(`Not a TerraForge dictionary (format should be "${CODEBOOK_FORMAT}").`)
  if (raw.version !== CODEBOOK_VERSION) {
    return fail(`Unsupported dictionary version ${String(raw.version)}; this version of TerraForge reads version ${CODEBOOK_VERSION}.`)
  }
  if (!Array.isArray(raw.codes)) return fail('"codes" must be a list.')

  const warnings: string[] = []

  const codes = new Map<string, CodeDef>()
  raw.codes.forEach((item, i) => {
    const where = `codes[${i}]`
    if (!isObject(item)) return void warnings.push(`${where}: not an object, skipped.`)

    const code = normalizeCode(item.code)
    if (code === null) return void warnings.push(`${where}: "code" must be a non-empty text value, skipped.`)

    const layer = typeof item.layer === 'string' ? item.layer.trim().toUpperCase() : ''
    if (layer === '' || layer.length > 255 || BAD_LAYER_CHARS.test(layer)) {
      return void warnings.push(`${where} (${code}): "layer" is missing or has characters DXF does not allow, skipped.`)
    }
    if (item.connect !== undefined && typeof item.connect !== 'boolean') {
      return void warnings.push(`${where} (${code}): "connect" must be true or false, skipped.`)
    }
    if (item.maxGap !== undefined && !isNonNegative(item.maxGap)) {
      return void warnings.push(`${where} (${code}): "maxGap" must be a number of 0 or more, skipped.`)
    }
    if (item.maxSkip !== undefined && !isNonNegative(item.maxSkip)) {
      return void warnings.push(`${where} (${code}): "maxSkip" must be a number of 0 or more, skipped.`)
    }
    if (codes.has(code)) warnings.push(`${where}: "${code}" appears more than once; the last entry wins.`)

    // Built field by field so unexpected properties in the file never reach the app.
    const def: CodeDef = {
      code,
      label: typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim().slice(0, 200) : code,
      layer,
      connect: item.connect === true,
    }
    if (typeof item.line === 'string' && item.line.trim() !== '') def.line = item.line.trim().slice(0, 80)
    if (item.closed === true) def.closed = true
    if (item.maxGap !== undefined) def.maxGap = item.maxGap as number
    if (item.maxSkip !== undefined) def.maxSkip = item.maxSkip as number
    if (item.closeNumbered === true) def.closeNumbered = true
    if (item.mayCross === true) def.mayCross = true
    if (item.boundary === true) def.boundary = true
    if (item.rectilinear === true) def.rectilinear = true
    if (typeof item.spurLayer === 'string' && item.spurLayer.trim() !== '') {
      const sl = item.spurLayer.trim().toUpperCase()
      if (sl.length > 255 || BAD_LAYER_CHARS.test(sl)) return void warnings.push(`${where} (${code}): "spurLayer" is not a valid DXF layer name, skipped.`)
      def.spurLayer = sl
    }
    if (item.spurAngle !== undefined) {
      if (!isNonNegative(item.spurAngle) || item.spurAngle > 90) return void warnings.push(`${where} (${code}): "spurAngle" must be 0 to 90 degrees, skipped.`)
      def.spurAngle = item.spurAngle
    }
    if (item.priority !== undefined) {
      if (typeof item.priority !== 'number' || !Number.isInteger(item.priority) || Math.abs(item.priority) > 100) return void warnings.push(`${where} (${code}): "priority" must be a whole number from -100 to 100, skipped.`)
      def.priority = item.priority
    }
    if (item.symbol !== undefined) {
      if (typeof item.symbol === 'string' && isSymbol(item.symbol.trim())) def.symbol = item.symbol.trim()
      else warnings.push(`${where} (${code}): "symbol" is not one of the known symbol blocks, ignored.`)
    }
    if (typeof item.symbolLayer === 'string' && item.symbolLayer.trim() !== '') {
      const sl = item.symbolLayer.trim().toUpperCase()
      if (sl.length > 255 || BAD_LAYER_CHARS.test(sl)) warnings.push(`${where} (${code}): "symbolLayer" is not a valid DXF layer name, ignored.`)
      else def.symbolLayer = sl
    }
    if (typeof item.alongside === 'string' && item.alongside.trim() !== '') def.alongside = item.alongside.trim().toUpperCase().slice(0, 80)
    codes.set(code, def)
  })

  if (codes.size === 0 && raw.codes.length > 0) return fail('None of the entries in "codes" were usable.', warnings)

  const layers = new Map<string, LayerDef>()
  if (raw.layers !== undefined) {
    if (!Array.isArray(raw.layers)) {
      warnings.push('"layers" must be a list, ignored.')
    } else {
      raw.layers.forEach((item, i) => {
        const where = `layers[${i}]`
        if (!isObject(item)) return void warnings.push(`${where}: not an object, skipped.`)
        const name = typeof item.name === 'string' ? item.name.trim().toUpperCase() : ''
        if (name === '' || name.length > 255 || BAD_LAYER_CHARS.test(name)) {
          return void warnings.push(`${where}: "name" is missing or not a valid DXF layer name, skipped.`)
        }
        const hex = item.hex === undefined ? undefined : normalizeHex(typeof item.hex === 'string' ? item.hex : '')
        if (item.hex !== undefined && hex === null) {
          return void warnings.push(`${where} (${name}): "hex" must look like #1a2b3c, skipped.`)
        }
        let aci = item.aci
        if (aci === undefined && hex) aci = nearestAci(hex)
        if (typeof aci !== 'number' || !Number.isInteger(aci) || aci < 1 || aci > 255) {
          return void warnings.push(`${where} (${name}): give "aci" (whole number 1 to 255) or "hex", skipped.`)
        }
        const label = typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim().slice(0, 200) : name
        layers.set(name, { name, aci, ...(hex ? { hex } : {}), label })
      })
    }
  }

  let maxGap: number | undefined
  if (raw.maxGap !== undefined) {
    if (isNonNegative(raw.maxGap)) maxGap = raw.maxGap
    else warnings.push('"maxGap" must be a number of 0 or more, ignored.')
  }

  let maxSkip: number | undefined
  if (raw.maxSkip !== undefined) {
    if (isNonNegative(raw.maxSkip)) maxSkip = raw.maxSkip
    else warnings.push('"maxSkip" must be a number of 0 or more, ignored.')
  }

  let minTurn: number | undefined
  if (raw.minTurn !== undefined) {
    if (isNonNegative(raw.minTurn) && raw.minTurn <= 120) minTurn = raw.minTurn
    else warnings.push('"minTurn" must be an angle from 0 to 120 degrees, ignored.')
  }

  let fillGaps: number | undefined
  if (raw.fillGaps !== undefined) {
    if (isNonNegative(raw.fillGaps)) fillGaps = raw.fillGaps
    else warnings.push('"fillGaps" must be a number of 0 or more, ignored.')
  }

  const avoidCrossings = typeof raw.avoidCrossings === 'boolean' ? raw.avoidCrossings : undefined
  if (raw.avoidCrossings !== undefined && avoidCrossings === undefined) warnings.push('"avoidCrossings" must be true or false, ignored.')

  let syntax: LineworkSyntax | undefined
  if (raw.syntax !== undefined) {
    if (!isObject(raw.syntax)) {
      warnings.push('"syntax" must be an object, ignored.')
    } else {
      const candidate = normalizeSyntax(raw.syntax as Partial<LineworkSyntax>)
      const problems = syntaxProblems(candidate)
      if (problems.length > 0) warnings.push(`"syntax" ignored: ${problems.join(' ')}`)
      else syntax = candidate
    }
  }

  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 120) : 'Imported dictionary'
  return { ok: true, warnings, book: { name, codes: [...codes.values()], layers: [...layers.values()], ...(maxGap !== undefined ? { maxGap } : {}), ...(maxSkip !== undefined ? { maxSkip } : {}), ...(avoidCrossings !== undefined ? { avoidCrossings } : {}), ...(fillGaps !== undefined ? { fillGaps } : {}), ...(minTurn !== undefined ? { minTurn } : {}), ...(syntax ? { syntax } : {}) } }
}

function fail(message: string, warnings: string[] = []): CodeBookResult {
  return { ok: false, errors: [message, ...warnings] }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export function isValidLayerName(name: string): boolean {
  return name !== '' && name.length <= 255 && !BAD_LAYER_CHARS.test(name)
}

export function normalizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.toUpperCase().replace(/\s+/g, ' ').trim()
  return s === '' || s.length > 80 ? null : s
}
