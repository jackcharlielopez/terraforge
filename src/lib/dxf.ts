import type { Annotation } from './boundary.ts'
import { ANNOTATION_LAYERS, LAYERS, MISC_LAYER, POINT_LAYERS } from './codes.ts'
import type { CodeDef, PointMatch, Polyline, SurveyPoint } from './types.ts'

export interface DxfOptions {
  /** Text height in drawing units. The reference drawing (1" = 40') uses 1.0. */
  textHeight: number
  /** Point symbol radius. The reference symbol (block SPT4) is a 0.5 circle. */
  markerRadius: number
  /** Layers to leave out of the file (mirrors the preview's layer toggles). */
  hiddenLayers: ReadonlySet<string>
  /** AutoCAD colour index per layer, e.g. from an imported dictionary. Unlisted layers use the built-ins, then white. */
  layerColors?: ReadonlyMap<string, number>
  /** Text drawn along lines, e.g. bearings and distances. */
  labels?: readonly Annotation[]
}

export const DEFAULT_DXF_OPTIONS: DxfOptions = {
  textHeight: 1,
  markerRadius: 0.5,
  hiddenLayers: new Set(),
}

const KNOWN_LAYERS = new Map([...POINT_LAYERS, ...ANNOTATION_LAYERS, ...LAYERS].map((l) => [l.name, l.aci]))

/**
 * Write an ASCII DXF in AutoCAD R12 format (AC1009).
 *
 * R12 is deliberately the lowest common denominator: no handles, no subclass markers,
 * opens in AutoCAD, Civil 3D, BricsCAD, QGIS and LibreCAD. Layout follows the reference
 * drawing: every point is a circle + POINT on PNTS at its true elevation, with number,
 * elevation and description as text on PNTNO / PNTELEV / PNTDESC. Matched codes also
 * place a POINT on their feature layer; connected runs become 3D polylines.
 */
export function buildDxf(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  polylines: Polyline[],
  options: DxfOptions = DEFAULT_DXF_OPTIONS,
): string {
  const visible = (layer: string) => !options.hiddenLayers.has(layer)
  const body: string[] = []
  const usedLayers = new Set<string>(['0'])
  const add = (layer: string, ...pairs: Array<[number, string | number]>) => {
    usedLayers.add(layer)
    pairs.forEach(([c, v]) => body.push(group(c, v)))
  }

  const h = options.textHeight
  const r = options.markerRadius

  points.forEach((p, i) => {
    const m = matches[i]
    const e = fmt(p.e)
    const n = fmt(p.n)
    const z = fmt(p.z)

    if (visible('PNTS')) {
      add('PNTS', [0, 'CIRCLE'], [8, 'PNTS'], [10, e], [20, n], [30, z], [40, fmt(r)])
      add('PNTS', [0, 'POINT'], [8, 'PNTS'], [10, e], [20, n], [30, z])
    }
    if (visible('PNTNO')) text('PNTNO', fmt(p.e), fmt(p.n + 0.75 * h), z, h, p.no, 'center')
    if (visible('PNTELEV')) text('PNTELEV', fmt(p.e + 1.5 * h), fmt(p.n - 0.5 * h), z, h, p.z.toFixed(3), 'left')
    if (visible('PNTDESC') && p.desc !== '') text('PNTDESC', fmt(p.e), fmt(p.n - 1.75 * h), z, h, p.desc, 'center')

    // "Every matching layer": one POINT per distinct feature layer the point belongs to.
    const layers = new Set<string>()
    for (const code of m.codes) {
      const def = defs.get(code)
      if (def) layers.add(def.layer)
    }
    if (m.unknown.length > 0) layers.add(MISC_LAYER)
    for (const layer of layers) {
      if (visible(layer)) add(layer, [0, 'POINT'], [8, layer], [10, e], [20, n], [30, z])
    }
  })

  function text(layer: string, x: string, y: string, z: string, height: number, value: string, align: 'left' | 'center') {
    const pairs: Array<[number, string | number]> = [[0, 'TEXT'], [8, layer], [10, x], [20, y], [30, z], [40, fmt(height)], [1, clean(value)]]
    if (align === 'center') pairs.push([72, 1], [11, x], [21, y], [31, z])
    add(layer, ...pairs)
  }

  for (const line of polylines) {
    if (!visible(line.layer) || line.vertices.length < 2) continue
    add(line.layer, [0, 'POLYLINE'], [8, line.layer], [66, 1], [10, '0.0'], [20, '0.0'], [30, '0.0'], [70, line.closed ? 9 : 8])
    for (const v of line.vertices) {
      add(line.layer, [0, 'VERTEX'], [8, line.layer], [10, fmt(v.e)], [20, fmt(v.n)], [30, fmt(v.z)], [70, 32])
    }
    add(line.layer, [0, 'SEQEND'], [8, line.layer])
  }

  for (const a of options.labels ?? []) {
    if (!visible(a.layer)) continue
    const x = fmt(a.x), y = fmt(a.y), z = fmt(a.z)
    add(a.layer, [0, 'TEXT'], [8, a.layer], [10, x], [20, y], [30, z], [40, fmt(a.height)], [1, cleanCad(a.cad)], [50, fmt(a.rotation)], [72, 1], [11, x], [21, y], [31, z])
  }

  const out: string[] = []
  const push = (...pairs: Array<[number, string | number]>) => pairs.forEach(([c, v]) => out.push(group(c, v)))

  // HEADER
  const ext = extents(points)
  push([0, 'SECTION'], [2, 'HEADER'])
  push([9, '$ACADVER'], [1, 'AC1009'])
  push([9, '$EXTMIN'], [10, fmt(ext.minE)], [20, fmt(ext.minN)], [30, fmt(ext.minZ)])
  push([9, '$EXTMAX'], [10, fmt(ext.maxE)], [20, fmt(ext.maxN)], [30, fmt(ext.maxZ)])
  push([9, '$PDMODE'], [70, 0])
  push([0, 'ENDSEC'])

  // TABLES
  push([0, 'SECTION'], [2, 'TABLES'])
  push([0, 'TABLE'], [2, 'LTYPE'], [70, 1])
  push([0, 'LTYPE'], [2, 'CONTINUOUS'], [70, 0], [3, 'Solid line'], [72, 65], [73, 0], [40, '0.0'])
  push([0, 'ENDTAB'])

  const layerNames = [...usedLayers].sort((a, b) => (a === '0' ? -1 : b === '0' ? 1 : a.localeCompare(b)))
  push([0, 'TABLE'], [2, 'LAYER'], [70, layerNames.length])
  for (const name of layerNames) {
    push([0, 'LAYER'], [2, name], [70, 0], [62, options.layerColors?.get(name) ?? KNOWN_LAYERS.get(name) ?? 7], [6, 'CONTINUOUS'])
  }
  push([0, 'ENDTAB'])

  push([0, 'TABLE'], [2, 'STYLE'], [70, 1])
  push([0, 'STYLE'], [2, 'STANDARD'], [70, 0], [40, '0.0'], [41, '1.0'], [50, '0.0'], [71, 0], [42, '0.2'], [3, 'txt'], [4, ''])
  push([0, 'ENDTAB'])
  push([0, 'ENDSEC'])

  // ENTITIES
  push([0, 'SECTION'], [2, 'ENTITIES'])
  out.push(...body)
  push([0, 'ENDSEC'])
  push([0, 'EOF'])

  return out.join('')
}

/** One DXF group: code right-aligned to width 3, value on the next line, CRLF endings. */
function group(code: number, value: string | number): string {
  return `${String(code).padStart(3, ' ')}\r\n${value}\r\n`
}

function fmt(n: number): string {
  // Fixed 3 decimals matches survey precision; avoids exponent notation.
  return n.toFixed(3)
}

/** R12 text is ANSI: strip control characters and non-ASCII, defuse %% control codes. */
function clean(s: string): string {
  return s
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/%%/g, '% %')
}

/** Like clean(), but keeps AutoCAD's %%d (degree), %%p and %%c symbol codes, which are what lets R12 hold a degree sign. */
function cleanCad(s: string): string {
  return s
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
}

function extents(points: SurveyPoint[]) {
  if (points.length === 0) return { minE: 0, minN: 0, minZ: 0, maxE: 0, maxN: 0, maxZ: 0 }
  let minE = Infinity, minN = Infinity, minZ = Infinity
  let maxE = -Infinity, maxN = -Infinity, maxZ = -Infinity
  for (const p of points) {
    minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e)
    minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n)
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
  }
  return { minE, minN, minZ, maxE, maxN, maxZ }
}
