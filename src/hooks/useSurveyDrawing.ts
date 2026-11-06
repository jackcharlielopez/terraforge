import { useMemo } from 'react'
import { buildBoundary, findCandidates } from '../lib/boundary.ts'
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
import { applyEdits, guessedEdges, segmentsOf } from '../lib/review.ts'
import type { ReviewEdits } from '../lib/review.ts'
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
  boundarySel: string[],
  /** A property line computed from a deed: drawn in place of the one from ticked pins. */
  boundaryOverride: Boundary | null,
  /** The drafter's changes to the generated drawing, and whether the guessed segments should be worked out (Review mode). */
  review: { active: boolean; edits: ReviewEdits },
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

  // Review mode: which segments came from the guessing steps (the rules alone are built again without them), and what the
  // drafter changed.
  const guessed = useMemo(() => {
    if (!review.active || points.length === 0) return new Set<string>()
    const raw = buildLinework(points, matches, dict, { maxGap, maxSkip, fillGaps, joinBy, explicitLines: syntax.explicitLines, guess: false })
    const baseHairpins = removeHairpins(raw, minTurn, undefined, false)
    const base = avoidCrossings ? removeCrossings(baseHairpins.lines).lines : baseHairpins.lines
    return guessedEdges(points, generated, base)
  }, [review.active, points, matches, dict, maxGap, maxSkip, fillGaps, joinBy, syntax.explicitLines, minTurn, avoidCrossings, generated])
  const lines = useMemo(() => applyEdits(points, generated, review.edits), [points, generated, review.edits])
  const generatedSegments = useMemo(() => (review.active ? segmentsOf(points, generated) : []), [review.active, points, generated])
  const segments = useMemo(() => (review.active ? segmentsOf(points, lines) : []), [review.active, points, lines])

  const crossings = useMemo(() => countCrossings(lines), [lines])

  // The property line is drawn from corner pins the user ticks (it is a legal call, not something the codes can decide).
  const candidates = useMemo(() => findCandidates(points, matches, dict), [points, matches, dict])
  const boundary = useMemo(() => boundaryOverride ?? buildBoundary(points, boundarySel), [points, boundarySel, boundaryOverride])
  const allLines = useMemo(() => (boundary ? [...lines, boundary.polyline] : lines), [lines, boundary])
  const labels = useMemo(() => boundary?.labels ?? [], [boundary])

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
    guessed,
    generatedSegments,
    segments,
    removedSegments: removedCrossing + undoubled.removed,
    crossings,
    candidates,
    boundary,
    layerRows,
  }
}
