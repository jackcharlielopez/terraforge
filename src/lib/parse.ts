import type { ParseResult, ParseWarning, SurveyPoint } from './types.ts'

/**
 * Parse a `P,N,E,Z,D` point file.
 *
 * Deliberately not a CSV parser: descriptions are free text and may contain
 * quotes (`IE 12"PIPE`) or commas, so only the first four commas separate fields
 * and everything after is the description. Bad lines are skipped with a warning
 * rather than failing the whole file.
 */
export function parsePoints(text: string): ParseResult {
  const points: SurveyPoint[] = []
  const warnings: ParseWarning[] = []
  const seen = new Set<string>()

  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  lines.forEach((raw, i) => {
    const lineNo = i + 1
    if (raw.trim() === '') return

    const parts = splitFirst(raw, ',', 4)
    if (parts.length < 3) {
      warnings.push({ line: lineNo, text: raw, reason: 'Fewer than 3 fields (need point, northing, easting)' })
      return
    }

    const no = parts[0].trim()
    const n = toNumber(parts[1])
    const e = toNumber(parts[2])
    const zText = parts[3]?.trim() ?? ''
    const z = zText === '' ? 0 : toNumber(zText)
    const desc = (parts[4] ?? '').trim()

    if (no === '') {
      warnings.push({ line: lineNo, text: raw, reason: 'Missing point number' })
      return
    }
    if (Number.isNaN(n) || Number.isNaN(e)) {
      warnings.push({ line: lineNo, text: raw, reason: 'Northing or easting is not a number' })
      return
    }
    if (Number.isNaN(z)) {
      warnings.push({ line: lineNo, text: raw, reason: 'Elevation is not a number' })
      return
    }
    if (seen.has(no)) {
      warnings.push({ line: lineNo, text: raw, reason: `Duplicate point number ${no} (kept)` })
    }
    seen.add(no)

    points.push({ no, n, e, z, desc, line: lineNo })
  })

  return { points, warnings }
}

function toNumber(s: string): number {
  const t = s.trim()
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN
  return Number(t)
}

/** Split on the first `max` occurrences of `sep`; the remainder stays in the last piece. */
function splitFirst(s: string, sep: string, max: number): string[] {
  const out: string[] = []
  let start = 0
  for (let k = 0; k < max; k++) {
    const idx = s.indexOf(sep, start)
    if (idx === -1) break
    out.push(s.slice(start, idx))
    start = idx + 1
  }
  out.push(s.slice(start))
  return out
}
