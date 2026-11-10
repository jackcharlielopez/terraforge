import symbolData from '../data/symbols.json' with { type: 'json' }
import type { CodeDef } from './types.ts'

/**
 * The firm's point symbols (iron pin, pole, valve, hydrant...), taken from the legend sheet by `scripts/extract-symbols.mjs` as plain
 * primitives. They are written into the DXF as block definitions and placed with INSERT, as the drafters' own drawings do, so they
 * stay one editable symbol each in CAD. Colour `k` 0 means "by block": the symbol takes the colour of the layer it sits on.
 */
export type Primitive =
  | { t: 'L'; a: [number, number]; b: [number, number]; k?: number }
  | { t: 'C'; c: [number, number]; r: number; k?: number }
  | { t: 'A'; c: [number, number]; r: number; s: number; e: number; k?: number }
  | { t: 'P'; v: Array<[number, number, number]>; closed: boolean; w?: number; k?: number }
  | { t: 'S'; p: Array<[number, number]>; k?: number }
  | { t: 'T'; p: [number, number]; h: number; s: string; ha: number; va: number; q?: [number, number]; k?: number }

export const SYMBOLS = symbolData as unknown as Record<string, Primitive[]>

/** What the legend calls each symbol. */
export const SYMBOL_LABELS: Record<string, string> = {
  SPT4: 'Iron Pin Set',
  SPT5: 'Iron Pin Found',
  SPT7: 'Deed Point',
  SPT13: 'Concrete Monument',
  SPT19: 'Utility Pole',
  SPT25: 'Gas Marker',
  SPT39: 'Water Valve',
  SPT41: 'Water Meter',
  SPT48: 'Light Pole',
  SPT49: 'Sewer Manhole',
  SPT107: 'PK Nail',
  SPT138: 'Fence Post',
  SPT214: 'Stake Set',
  CG101: 'PP Transformer',
  CG152: 'Fire Hydrant',
  CG161: 'Sewer Manhole',
  'SSWR-13': 'Sewer Cleanout',
  'STRM-18': 'Stormwater Catch Basin',
  'NGAS-01': 'Gas Valve',
  'NGAS-04': 'Gas Marker',
  'POWR-02': 'Electric Box',
  'COMM-02': 'Underground Cable',
  'WATR-02': 'Water Meter',
}

/**
 * How big each symbol is drawn, as a multiple of the point marker (SPT4), read off the legend sheet (symbol scale divided by the
 * pin-set scale). The drawing's marker size then scales every symbol with it.
 */
export const SYMBOL_RATIO: Record<string, number> = {
  SPT4: 1,
  SPT5: 1,
  SPT7: 1,
  SPT13: 1,
  SPT19: 1.6,
  SPT25: 1.33,
  SPT39: 1.6,
  SPT41: 1.33,
  SPT48: 1.32,
  SPT49: 1.32,
  SPT107: 1.33,
  SPT138: 1.33,
  SPT214: 1.21,
  CG101: 1.42,
  CG152: 12.35,
  CG161: 8.1,
  'SSWR-13': 1.22,
  'STRM-18': 1.55,
  'NGAS-01': 1.55,
  'NGAS-04': 1.54,
  'POWR-02': 1.6,
  'COMM-02': 1.6,
  'WATR-02': 7.2,
}

export const isSymbol = (name: string): boolean => Object.hasOwn(SYMBOLS, name)

/**
 * Things the rules leave as plain points (a stake, a post: never a line) still get their legend symbol. Evidence for these is the
 * finished drawings: the stake-set symbol on every STK shot, the fence-post symbol on T-posts and nails in wire fence posts.
 */
const POINT_SYMBOLS: Array<{ test: RegExp; symbol: string; layer: string }> = [
  { test: /^STK\b/, symbol: 'SPT214', layer: 'V-PROP' },
  { test: /\bT ?POST\b|\bWFP\b/, symbol: 'SPT138', layer: 'V-SITE-FENC' },
]

export function symbolForDescription(desc: string): { symbol: string; layer: string } | null {
  const d = desc.toUpperCase().trim()
  const hit = POINT_SYMBOLS.find((r) => r.test.test(d))
  return hit ? { symbol: hit.symbol, layer: hit.layer } : null
}

/**
 * Which symbols a shot gets, and on which layer: the symbol of each code it matched (once per symbol and layer); else, for what the
 * rules leave as a plain point (a stake, a post), the symbol for its description. The DXF and the preview both use this.
 */
export function pointSymbols(codes: readonly string[], defs: ReadonlyMap<string, CodeDef>, desc: string): Array<{ symbol: string; layer: string }> {
  const out = new Map<string, { symbol: string; layer: string }>()
  for (const code of codes) {
    const def = defs.get(code)
    if (def?.symbol && SYMBOLS[def.symbol]) out.set(`${def.symbol}@${def.symbolLayer ?? def.layer}`, { symbol: def.symbol, layer: def.symbolLayer ?? def.layer })
  }
  if (out.size === 0) {
    const ps = symbolForDescription(desc)
    if (ps && SYMBOLS[ps.symbol]) out.set(`${ps.symbol}@${ps.layer}`, ps)
  }
  return [...out.values()]
}
