import { findCandidates } from './boundary.ts'
import { matchDescription } from './codes.ts'
import type { Anchor } from './deedfit.ts'
import { deriveRules } from './rules.ts'
import type { SurveyPoint } from './types.ts'

/** The iron pins and monuments found in the field (points coded IPF, IPS, monument...): what a deed outline is placed on. */
export function foundPins(points: SurveyPoint[]): Anchor[] {
  if (points.length === 0) return []
  const { dict } = deriveRules(points)
  const matches = points.map((p) => matchDescription(p.desc, dict))
  return findCandidates(points, matches, dict).map((c) => ({ no: c.no, e: c.e, n: c.n }))
}
