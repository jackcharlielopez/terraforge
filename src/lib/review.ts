import { rebuildWithout } from './geometry.ts'
import type { PointMatch, Polyline, SurveyPoint } from './types.ts'

/** A segment between two survey points, named by their positions in the points list ("3-17", smaller first). */
export type EdgeKey = string

export const edgeKey = (i: number, j: number): EdgeKey => (i < j ? `${i}-${j}` : `${j}-${i}`)

export interface Segment {
  a: number
  b: number
  key: EdgeKey
  layer: string
  /** Which part of the drawing logic made the line this segment belongs to. */
  lineKey: string
}

/** What the drafter did to the generated drawing. */
export interface ReviewEdits {
  /** Segments the drafter looked at and kept. */
  accepted: EdgeKey[]
  /** Segments the drafter removed. */
  rejected: EdgeKey[]
  /** Lines the drafter drew between two points. */
  added: Array<{ a: number; b: number; layer: string }>
}

export const EMPTY_EDITS: ReviewEdits = { accepted: [], rejected: [], added: [] }

const posKey = (e: number, n: number) => `${e.toFixed(3)},${n.toFixed(3)}`

/** Where each survey point sits in the list, by position (the first one wins when two shots share a spot). */
export function pointIndex(points: SurveyPoint[]): Map<string, number> {
  const index = new Map<string, number>()
  points.forEach((p, i) => {
    const k = posKey(p.e, p.n)
    if (!index.has(k)) index.set(k, i)
  })
  return index
}

/** Every segment of the lines that runs between two survey points (a closing segment included). */
export function segmentsOf(points: SurveyPoint[], lines: Polyline[], index = pointIndex(points)): Segment[] {
  const out: Segment[] = []
  for (const l of lines) {
    const v = l.vertices
    const pairs: Array<[number, number]> = v.slice(1).map((_, i) => [i, i + 1])
    if (l.closed && v.length > 2) pairs.push([v.length - 1, 0])
    for (const [x, y] of pairs) {
      const a = index.get(posKey(v[x].e, v[x].n))
      const b = index.get(posKey(v[y].e, v[y].n))
      if (a === undefined || b === undefined || a === b) continue
      out.push({ a, b, key: edgeKey(a, b), layer: l.layer, lineKey: l.key })
    }
  }
  return out
}

/** The drawing with the drafter's removals applied and their added lines appended. */
export function applyEdits(points: SurveyPoint[], lines: Polyline[], edits: ReviewEdits): Polyline[] {
  if (edits.rejected.length === 0 && edits.added.length === 0) return lines
  const index = pointIndex(points)
  const rejected = new Set(edits.rejected)
  const dropBy = new Map<number, Set<number>>()
  lines.forEach((l, li) => {
    const v = l.vertices
    const total = l.closed && v.length > 2 ? v.length : v.length - 1
    for (let i = 0; i < total; i++) {
      const a = index.get(posKey(v[i].e, v[i].n))
      const b = index.get(posKey(v[(i + 1) % v.length].e, v[(i + 1) % v.length].n))
      if (a === undefined || b === undefined || !rejected.has(edgeKey(a, b))) continue
      const set = dropBy.get(li) ?? new Set<number>()
      set.add(i)
      dropBy.set(li, set)
    }
  })
  const kept = dropBy.size === 0 ? lines : rebuildWithout(lines, dropBy)
  const added: Polyline[] = edits.added.map(({ a, b, layer }) => ({
    layer,
    key: 'drafter',
    closed: false,
    mayCross: true,
    vertices: [a, b].map((i) => ({ e: points[i].e, n: points[i].n, z: points[i].z })),
  }))
  return [...kept, ...added]
}

/** Segments in `final` that the rules-only baseline did not produce: the repair, continuation and cap steps made them. */
export function guessedEdges(points: SurveyPoint[], final: Polyline[], baseline: Polyline[]): Set<EdgeKey> {
  const index = pointIndex(points)
  const base = new Set(segmentsOf(points, baseline, index).map((s) => s.key))
  return new Set(segmentsOf(points, final, index).filter((s) => !base.has(s.key)).map((s) => s.key))
}

export interface ReviewEvent {
  /** Milliseconds since the epoch. */
  t: number
  type: 'accept' | 'reject' | 'add' | 'undo'
  /** Point numbers as written in the file. */
  a: string
  b: string
  layer: string
  /** Where the segment came from: the rules, one of the guessing steps, or the drafter. */
  source: 'rule' | 'guess' | 'manual'
}

/** A short fingerprint of a points file (djb2 over number, position and description), so a reopened file finds its review. */
export function fingerprint(points: SurveyPoint[]): string {
  let h = 5381
  for (const p of points) {
    const s = `${p.no}|${p.e}|${p.n}|${p.desc};`
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return `${points.length}-${(h >>> 0).toString(16)}`
}

export interface ReviewExport {
  format: 'terraforge-review-log'
  version: 1
  fingerprint: string
  /** Coordinates are relative to the middle of the job, so the log says nothing about where it is. */
  note: string
  settings: Record<string, unknown>
  points: Array<{ no: string; e: number; n: number; z: number; desc: string; codes: string[] }>
  /** What the program drew before the drafter touched it, with where each segment came from. */
  generated: Array<{ a: string; b: string; layer: string; source: 'rule' | 'guess' }>
  /** What the drawing looks like after the drafter's changes. */
  final: Array<{ a: string; b: string; layer: string; source: 'rule' | 'guess' | 'manual' }>
  events: ReviewEvent[]
}

/**
 * The review as a file the drafter can inspect and send on, or keep. It holds point numbers, codes, positions relative to the
 * job's centre, and the lines: no file name, no client name, no address, no deed.
 */
export function buildReviewExport(args: {
  points: SurveyPoint[]
  matches: PointMatch[]
  settings: Record<string, unknown>
  generated: Segment[]
  final: Segment[]
  guessed: ReadonlySet<EdgeKey>
  added: ReadonlySet<EdgeKey>
  events: ReviewEvent[]
}): ReviewExport {
  const { points, matches } = args
  const cx = points.reduce((t, p) => t + p.e, 0) / Math.max(points.length, 1)
  const cy = points.reduce((t, p) => t + p.n, 0) / Math.max(points.length, 1)
  const r = (x: number) => Math.round(x * 1000) / 1000
  const no = (i: number) => points[i].no
  const source = (k: EdgeKey): 'rule' | 'guess' | 'manual' => (args.added.has(k) ? 'manual' : args.guessed.has(k) ? 'guess' : 'rule')
  return {
    format: 'terraforge-review-log',
    version: 1,
    fingerprint: fingerprint(points),
    note: 'Positions are relative to the centre of the job. Nothing here names the client, the file or the place.',
    settings: args.settings,
    points: points.map((p, i) => ({ no: p.no, e: r(p.e - cx), n: r(p.n - cy), z: r(p.z), desc: p.desc, codes: matches[i]?.codes ?? [] })),
    generated: args.generated.map((s) => ({ a: no(s.a), b: no(s.b), layer: s.layer, source: args.guessed.has(s.key) ? 'guess' : 'rule' })),
    final: args.final.map((s) => ({ a: no(s.a), b: no(s.b), layer: s.layer, source: source(s.key) })),
    events: args.events,
  }
}
