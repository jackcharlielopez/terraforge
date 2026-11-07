import { fitOutline, tooBigToFit } from './deedfit.ts'
import type { Anchor, Placement } from './deedfit.ts'
import { snapToOutlines } from './deedsnap.ts'
import { partlyOverlaps } from './overlap.ts'
import type { Vertex } from './traverse.ts'

export interface Item {
  /** Whatever names this outline to the caller (deed and description). */
  key: string
  /** The outline's corners from the deed, in the order of the calls. */
  corners: Vertex[]
  /** False for a read that failed its checks (it does not close, or does not match the acreage). Such an outline can still be placed on pins, but no other outline is attached to it. Default true. */
  trusted?: boolean
}

export type Result =
  | { key: string; how: 'pins'; vertices: Vertex[]; rotation: number; placement: Placement }
  | { key: string; how: 'shared line'; vertices: Vertex[]; rotation: number; sharedFeet: number; withKey: string }
  | { key: string; how: 'none'; reason: string }

/**
 * Place every outline it can. First those with enough found pins on their lines; then, over and over until nothing more attaches, those that
 * share a line with one already placed (adjoiners have no pins of their own). What cannot be placed is returned with the reason.
 */
export function placeAll(items: Item[], anchors: Anchor[]): Result[] {
  const done = new Map<string, Result>()
  // only trusted outlines are used to place others: a shape that failed its checks must not pull its neighbours out of position
  const placed: Array<{ key: string; vertices: Vertex[] }> = []
  // Most convincing fits first: more pins on the lines, and more of them at corners. A weaker fit that would lie partly on top of one
  // already accepted is the wrong one of the two, so it is left for the shared-line step (neighbours have no pins of their own).
  const fits = items.flatMap((it) => {
    const p = fitOutline(it.corners, anchors)
    return p ? [{ it, p, evidence: p.hits.length + p.hits.filter((h) => h.corner !== null).length }] : []
  })
  fits.sort((a, b) => Number(b.it.trusted !== false) - Number(a.it.trusted !== false) || b.evidence - a.evidence)
  for (const { it, p } of fits) {
    if (placed.some((o) => partlyOverlaps(p.vertices, o.vertices))) continue
    done.set(it.key, { key: it.key, how: 'pins', vertices: p.vertices, rotation: p.rotation, placement: p })
    if (it.trusted !== false) placed.push({ key: it.key, vertices: p.vertices })
  }
  for (let again = true; again; ) {
    again = false
    for (const it of items) {
      if (done.has(it.key)) continue
      const s = snapToOutlines(it.corners, placed.map((p) => p.vertices))
      if (!s || placed.some((o) => partlyOverlaps(s.vertices, o.vertices))) continue
      done.set(it.key, { key: it.key, how: 'shared line', vertices: s.vertices, rotation: s.rotation, sharedFeet: s.sharedFeet, withKey: placed[s.to].key })
      if (it.trusted !== false) {
        placed.push({ key: it.key, vertices: s.vertices })
        again = true
      }
    }
  }
  return items.map(
    (it) =>
      done.get(it.key) ?? {
        key: it.key,
        how: 'none' as const,
        reason: tooBigToFit(it.corners, anchors)
          ? 'it has too many corners, and the job too many found pins, to fit automatically'
          : anchors.length < 3
            ? 'too few found pins in the points, and it shares no line with another outline'
            : 'fewer than three found pins lie on its lines, and it shares no line with a placed outline',
      },
  )
}
