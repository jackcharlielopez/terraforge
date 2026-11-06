import { countCrossings } from './geometry.ts'
import type { RefShapes } from './dxfview.ts'
import type { Polyline, SurveyPoint } from './types.ts'

export interface CompareStats {
  /** Distinct positions of POINT entities in the reference. */
  refPoints: number
  genPoints: number
  /** Generated points that sit at the same position as a reference POINT. */
  matchedPoints: number
  /** Reference line segments whose two ends are both generated survey points. */
  refSegments: number
  genSegments: number
  /** Generated segments the reference also has between the same two points. */
  matchedSegments: number
  /** Places where our lines cross each other, and where the reference's point-to-point lines do (null = too large to check). */
  genCrossings: number | null
  refCrossings: number | null
}

/** Layers in a finished drawing whose lines legitimately cross other things (property, easement, overhead power, pipes). */
const MAY_CROSS_LAYER = /^V-(PROP|ESMT|POWR-OVHD|WATR-PIPE|NGAS-UNDR|SSWR-PIPE)/

const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`
const edge = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * How closely the generated drawing agrees with a finished one, judged only on what can be
 * compared fairly: point positions, and line segments that run between two survey points.
 * Building outlines from offset shots, property lines etc. have no point-to-point equivalent
 * and are deliberately left out (see reference/DXF-NOTES.md).
 */
export function compareWithReference(points: SurveyPoint[], lines: Polyline[], ref: RefShapes): CompareStats {
  const gen = new Set(points.map((p) => key(p.e, p.n)))
  const refPts = new Set(ref.points.map((p) => key(p.x, p.y)))

  const segments = (polys: Array<{ pts: Array<[number, number]>; closed: boolean }>) => {
    const set = new Set<string>()
    for (const l of polys) {
      const k = l.pts.map(([x, y]) => key(x, y))
      k.slice(1).forEach((b, i) => set.add(edge(k[i], b)))
      if (l.closed && k.length > 2) set.add(edge(k[k.length - 1], k[0]))
    }
    return set
  }

  const genSeg = segments(lines.map((l) => ({ pts: l.vertices.map((v): [number, number] => [v.e, v.n]), closed: l.closed })))
  const refSeg = new Set([...segments(ref.edges)].filter((s) => s.split('|').every((p) => gen.has(p))))

  const refPointLines = ref.edges
    .filter((l) => l.pts.every(([x, y]) => gen.has(key(x, y))))
    .map((l) => ({ layer: l.layer, key: l.layer, mayCross: MAY_CROSS_LAYER.test(l.layer), closed: l.closed, vertices: l.pts.map(([x, y]) => ({ e: x, n: y, z: 0 })) }))

  return {
    genCrossings: countCrossings(lines),
    refCrossings: countCrossings(refPointLines),
    refPoints: refPts.size,
    genPoints: gen.size,
    matchedPoints: [...gen].filter((k) => refPts.has(k)).length,
    refSegments: refSeg.size,
    genSegments: genSeg.size,
    matchedSegments: [...genSeg].filter((s) => refSeg.has(s)).length,
  }
}
