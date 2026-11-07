import { useMemo } from 'react'
import { pinLinesAlong } from '../lib/pinlines.ts'
import { buildBoundary, findCandidates, suggestBoundary } from '../lib/boundary.ts'
import type { Boundary } from '../lib/boundary.ts'
import {
  ANNOTATION_LAYERS,
  DEFAULT_AVOID_CROSSINGS,
  DEFAULT_FILL_GAPS,
  DEFAULT_MAX_GAP,
  DEFAULT_MAX_SKIP,
  DEFAULT_MIN_TURN,
  POINT_LAYERS,
  matchDescription,
} from '../lib/codes.ts'
import { deriveRules } from '../lib/rules.ts'
import { SCRAMBLED_BELOW, orderliness } from '../lib/gapfill.ts'
import { countCrossings, removeCrossings, removeHairpins } from '../lib/geometry.ts'
import { aciToHex } from '../lib/aci.ts'
import { buildLinework } from '../lib/linework.ts'
import { layerCounts } from '../lib/summary.ts'
import { normalizeSyntax } from '../lib/syntax.ts'
import type { ParseResult } from '../lib/types.ts'

/**
 * Everything derived from the points, in one place: what each description means (the built-in rules), linework (with
 * crossings removed), the boundary, and the layer list the sidebar shows. Nothing here holds state; it recomputes only
 * when an input changes. The linework settings are fixed: there is nothing for the user to tune.
 */
export function useSurveyDrawing(
  parsed: ParseResult | null,
  /** The pins the surveyor ticked for the property line; null means "choose them for me" (the default). */
  pinSelection: string[] | null,
  /** Outlines placed from deeds and plats, each drawn on the DEED layer with its bearing labels. */
  deedBoundaries: Boundary[],
) {
  const points = useMemo(() => parsed?.points ?? [], [parsed])
  const rules = useMemo(() => deriveRules(points), [points])
  const { dict } = rules
  const layerList = useMemo(() => [...POINT_LAYERS, ...ANNOTATION_LAYERS, ...rules.layers], [rules])
  const layerAci = useMemo(() => new Map(layerList.map((l) => [l.name, l.aci])), [layerList])
  const layerHex = useMemo(() => new Map(layerList.map((l) => [l.name, l.hex ?? aciToHex(l.aci)])), [layerList])
  const syntax = useMemo(() => normalizeSyntax(undefined), [])
  const matches = useMemo(() => points.map((p) => matchDescription(p.desc, dict, syntax)), [points, dict, syntax])

  // How far the point numbers can be trusted. Scrambled numbering makes shot order meaningless, so the lines are then
  // found from where the points are instead.
  const orderly = useMemo(() => orderliness(points, matches, dict), [points, matches, dict])
  const joinBy: 'order' | 'position' = orderly < SCRAMBLED_BELOW ? 'position' : 'order'

  const maxGap = DEFAULT_MAX_GAP
  const maxSkip = DEFAULT_MAX_SKIP
  const fillGaps = DEFAULT_FILL_GAPS
  const minTurn = DEFAULT_MIN_TURN
  const avoidCrossings = DEFAULT_AVOID_CROSSINGS
  const rawLines = useMemo(
    () => buildLinework(points, matches, dict, { maxGap, maxSkip, fillGaps, joinBy, explicitLines: syntax.explicitLines }),
    [points, matches, dict, maxGap, maxSkip, fillGaps, joinBy, syntax.explicitLines],
  )
  // Surface-feature lines should not double back or cross each other: drop the segments that cause it (unless switched off).
  const undoubled = useMemo(() => removeHairpins(rawLines, minTurn), [rawLines, minTurn])
  const { lines: generated, removed: removedCrossing } = useMemo(
    () => (avoidCrossings ? removeCrossings(undoubled.lines) : { lines: undoubled.lines, removed: 0 }),
    [undoubled, avoidCrossings],
  )

  const lines = generated

  const crossings = useMemo(() => countCrossings(lines), [lines])

  // The property line is drawn from corner pins the user ticks (it is a legal call, not something the codes can decide).
  const candidates = useMemo(() => findCandidates(points, matches, dict), [points, matches, dict])
  // Which pins make the property line: the surveyor's ticks, else chosen automatically. With a deed outline drawn, none: the outline is the
  // property line (pins on its corners would draw a triangle for a four-cornered lot). Without one, the pins sharing the most common cap
  // number: a guess (on some jobs they are the neighbour's), so the surveyor unticks what is wrong.
  const autoPins = useMemo(() => (deedBoundaries.some((b) => b.polyline.layer === 'DEED') ? [] : suggestBoundary(candidates)), [candidates, deedBoundaries])
  const boundarySel = pinSelection ?? autoPins
  const boundary = useMemo(() => buildBoundary(points, boundarySel), [points, boundarySel])
  // The drafter draws the property line pin to pin: along each trusted deed outline, join the found pins that sit on it.
  const pinLines = useMemo(() => deedBoundaries.filter((b) => b.polyline.layer === 'DEED').flatMap((b) => pinLinesAlong(b.polyline, candidates)), [deedBoundaries, candidates])
  const allLines = useMemo(() => [...lines, ...pinLines, ...(boundary ? [boundary.polyline] : []), ...deedBoundaries.map((b) => b.polyline)], [lines, pinLines, boundary, deedBoundaries])
  const labels = useMemo(() => [...(boundary?.labels ?? []), ...deedBoundaries.flatMap((b) => b.labels)], [boundary, deedBoundaries])

  const layerRows = useMemo(
    () => layerCounts(matches, dict, [...allLines.map((l) => l.layer), ...labels.map((a) => a.layer)], points.length),
    [matches, dict, allLines, labels, points],
  )

  return {
    layerList,
    layerAci,
    layerHex,
    dict,
    syntax,
    points,
    matches,
    orderly,
    joinBy,
    allLines,
    labels,
    removedSegments: removedCrossing + undoubled.removed,
    crossings,
    candidates,
    boundarySel,
    boundary,
    layerRows,
  }
}
