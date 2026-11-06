import { MISC_LAYER, POINT_LAYERS } from './codes.ts'
import type { Dictionary } from './codes.ts'
import type { PointMatch } from './types.ts'

export interface LayerRow {
  name: string
  n: number
}

/**
 * The layers that will exist in the output, with how many points sit on each. A point counts once per layer even if
 * several of its codes map there; points with an unrecognised code count on the catch-all layer. Layers that only carry
 * drawn lines or labels are listed with 0.
 */
export function layerCounts(
  matches: readonly PointMatch[],
  dict: Dictionary,
  extraLayers: readonly string[],
  pointCount: number,
): LayerRow[] {
  const counts = new Map<string, number>()
  for (const m of matches) {
    const seen = new Set<string>()
    for (const c of m.codes) {
      const layer = dict.get(c)?.layer
      if (layer) seen.add(layer)
    }
    if (m.unknown.length) seen.add(MISC_LAYER)
    for (const l of seen) counts.set(l, (counts.get(l) ?? 0) + 1)
  }
  for (const l of extraLayers) if (!counts.has(l)) counts.set(l, 0)
  return [...POINT_LAYERS.map((l) => ({ name: l.name, n: pointCount })), ...[...counts].map(([name, n]) => ({ name, n }))]
}
