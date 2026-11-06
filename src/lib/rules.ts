import { LAYERS, STARTER_CODES, buildDictionary, matchDescription, normalize } from './codes.ts'
import type { Dictionary } from './codes.ts'
import type { CodeDef, LayerDef, SurveyPoint } from './types.ts'

/**
 * The built-in rules: what a point description means, worked out from the words in it. There is no dictionary to load
 * or edit. The starter codes (src/data/starter-codes.json) are the built-in knowledge for the codes a firm is likely to
 * use; everything else is decided here from conditions on the description, so a job from a crew with its own habits
 * still draws something sensible:
 *
 *  - words that mark something that is never a line (a stake, a post, flagging, a monument or corner) leave the point as a point;
 *  - keywords choose the layer and which shots belong to one line (every FENCE variant is one fence, every "CL ..." that names a
 *    stream is a stream centreline, "CL <road>" a road centreline, TREE LINE and EDGE OF FIELD one tree line);
 *  - any other description used at least twice is a line of its own (shots with the same description go together);
 *  - a description used once, or one or two characters long, stays a point.
 *
 * `overrides` is where a smarter classifier (an AI model that has read the description) can plug in later: a def replaces what
 * the rules decided, `null` forces the description to stay a point.
 */

/** Shots of an unrecognised feature are often far apart in the field (fences, tree lines, centrelines), and a few other shots may sit between them. */
const AUTO_MAX_GAP = 400
const AUTO_MAX_SKIP = 8
/** A description needs at least this many shots to be drawn as a line. */
const MIN_SHOTS = 2
/** Shorter than this is a marker, not a feature name ("X", "EG"). */
const MIN_LENGTH = 3

interface Rule {
  test: RegExp
  /** Leave the point as a point. */
  point?: true
  layer?: string
  label?: string
  /** Shots sharing this key are one line, whatever their exact words. Omitted: the description itself. */
  line?: string
  mayCross?: true
  /** Close the line back to its first shot (a building). */
  closed?: true
}

/** Checked in order; the first rule that matches wins. */
const RULES: Rule[] = [
  // never a line
  { test: /\b(T ?POST|STAKE|FLAGGING|FLAGGED|GUY|NAIL|REBAR|MONUMENT|MONUMNT|CRNR|CORNER)\b|^(STK|COR|TOB|IP[FS]|PK|SPK|PIN)\b|^T ?POST/, point: true },
  // the centreline of a driveway is a tie to where the drive is, not a line the drafter draws
  { test: /^CL\b.*\b(DW|DRIVEWAY)\b/, point: true },
  // fences, whatever the wording (FENCE BARB OLD, WH OAK FENCE BARB OLD/NEW, OLD FEN ON GRD)
  { test: /\b(FENCE|FEN)\b/, layer: 'V-SITE-FENC', label: 'Fence', line: 'FENCE' },
  // "CL <thing>": a centreline of whatever follows
  // a road's name can contain a stream word (FOX BRANCH RD), so a road suffix decides first
  { test: /^CL\b.*\b(RD|ROAD|ST|STREET|AVE|AVENUE|LN|LANE|HWY|HIGHWAY|DR|CT|PIKE|WAY|BLVD|PKWY)\b/, layer: 'V-ROAD-CNTR', label: 'Road centerline' },
  { test: /^CL\b.*\b(CREEK|BRANCH|SPRING|STREAM|RIVER|RUN|DITCH|DRAIN)\b/, layer: 'V-STRM-CNTR', label: 'Stream centerline', line: 'STREAM CL' },
  { test: /^CL\b/, layer: 'V-ROAD-CNTR', label: 'Road centerline' },
  { test: /^(HC|BC|HSE|HOUSE|BLDG|BUILDING|SHED|GARAGE|CARPORT)\b/, layer: 'V-BLDG-OTLN', label: 'Building', line: 'BUILDING', closed: true },
  { test: /^(SS|SAN|SEWER)\b.*\bMH\b|^SS$/, layer: 'V-SSWR-PIPE', label: 'Sewer', line: 'SEWER', mayCross: true },
  { test: /\bTREE ?LINE\b|\bEDGE OF (FIELD|WOODS|TREES|BRUSH)\b|\bWOODS?\b/, layer: 'V-TREE-LINE', label: 'Tree line', line: 'TREE LINE' },
  { test: /\b(FIELD PATH|CART PATH|TRAIL|OLD (CUT )?RD|OLD ROAD)\b/, layer: 'V-ROAD-TRAL', label: 'Path or old road', line: 'PATH' },
  { test: /^(PP|POLE|POWER POLE|OHPL?|OH POWER)\b/, layer: 'V-POWR-OVHD', label: 'Overhead power', line: 'POWER', mayCross: true },
]

/** An AI classifier's answer for one description: the definition to use, or null to keep it a point. */
export type Overrides = ReadonlyMap<string, CodeDef | null>

export interface DerivedRules {
  dict: Dictionary
  /** The output layers: the built-in ones plus those the rules created for this job. */
  layers: LayerDef[]
}

/** ACI colours handed to layers the rules create, in turn. */
const PALETTE = [30, 40, 50, 70, 90, 110, 130, 150, 170, 190, 210, 230, 15, 55, 95, 135, 175, 215, 20, 60]

const slug = (s: string) => s.replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'MISC'

/** What the rules make of one description that the starter codes do not know, or null when it stays a point. */
export function classifyDescription(token: string, shots: number): { def: CodeDef } | null {
  const t = normalize(token)
  if (shots < MIN_SHOTS) return null
  const rule = RULES.find((r) => r.test.test(t))
  if (rule?.point || (!rule && t.length < MIN_LENGTH)) return null
  const layer = rule?.layer ?? 'V-LINE-' + slug(t)
  const def: CodeDef = {
    code: t,
    label: rule?.label ?? t,
    layer,
    connect: true,
    line: rule?.line ?? t,
    maxGap: AUTO_MAX_GAP,
    maxSkip: AUTO_MAX_SKIP,
    ...(rule?.mayCross ? { mayCross: true } : {}),
    ...(rule?.closed ? { closed: true } : {}),
  }
  return { def }
}

/** Work out the codes and layers for one job from its point descriptions. */
export function deriveRules(points: SurveyPoint[], overrides?: Overrides): DerivedRules {
  const builtIn = buildDictionary(STARTER_CODES)
  const shots = new Map<string, number>()
  for (const p of points) for (const u of matchDescription(p.desc, builtIn).unknown) shots.set(u, (shots.get(u) ?? 0) + 1)

  const defs: CodeDef[] = [...STARTER_CODES]
  const layers: LayerDef[] = [...LAYERS]
  const known = new Set(layers.map((l) => l.name))
  let next = 0
  for (const [token, n] of shots) {
    const over = overrides?.get(token)
    const made = over === undefined ? classifyDescription(token, n)?.def : over
    if (!made) continue
    defs.push(made)
    if (!known.has(made.layer)) {
      known.add(made.layer)
      layers.push({ name: made.layer, aci: PALETTE[next++ % PALETTE.length], label: made.label })
    }
  }
  return { dict: buildDictionary(defs), layers }
}
