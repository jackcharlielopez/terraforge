/**
 * Reading the calls (bearing and distance) out of the text of a deed or plat description, with plain rules: no AI.
 * The text usually comes from OCR, so everything here is tolerant of the mistakes OCR makes. A read is never trusted on
 * its own: `traverse.ts` checks that the calls close and match the stated acreage.
 */

export interface Call {
  /** North or south. */
  ns: 'N' | 'S'
  /** East or west. */
  ew: 'E' | 'W'
  /** Whole degrees; null when the digits could not be read. */
  deg: number | null
  min: number
  sec: number
  /** Feet. */
  distance: number
  /** The degrees could not be read and no other call could stand in for them. */
  unsure: boolean
  /** Set when an unreadable bearing was filled in from the opposite side; says from what. */
  inferred?: string
  /** The call as it was read, for showing next to the scan. */
  text: string
  /** A circular arc: the bearing and distance above are then the CHORD, and this gives the arc. Absent for a straight line. */
  curve?: Curve
  /** How sure the reader is of this call (the AI reader says so; rules and OCR do not). A low one is never trusted on the checks alone. */
  confidence?: 'high' | 'medium' | 'low'
  /** Why a call needs a look, when the reader found something wrong with it (shown as a tooltip). */
  note?: string
}

export interface Curve {
  /** Feet. */
  radius: number
  /** Which way the line turns as it is walked: left (counter-clockwise) or right (clockwise). */
  direction: 'L' | 'R'
  /** Feet along the arc, when the description gives it. */
  arcLength?: number
}

export interface Tract {
  label: string
  calls: Call[]
  /** The acreage the description states, if it states one. */
  statedAcres: number | null
  /** Bearings mentioned in the text beyond the calls read: a dropped call, or a tie bearing (see `unreadBearings`). */
  unreadBearings?: number
  /** What kind of description this is, when the reader says (a lot reference, an easement in words, metes and bounds...). */
  descriptionType?: DescriptionType
  /** What the reader noted about it. */
  notes?: string
}

export type DescriptionType = 'metes_and_bounds' | 'lot_reference' | 'aliquot' | 'centerline' | 'blanket' | 'exhibit_referenced' | 'facility_relative' | 'words_only'

const levenshtein = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length][b.length]
}

/** East or west from a word OCR may have mangled ("FgEagt" is East). */
function direction(word: string): 'E' | 'W' | null {
  const w = word.toLowerCase()
  if (w === 'e' || w === 'east') return 'E'
  if (w === 'w' || w === 'west') return 'W'
  if (w.length < 3) return null
  const tolerance = w.length >= 6 ? 3 : 2
  const east = levenshtein(w, 'east')
  const west = levenshtein(w, 'west')
  if (east <= tolerance && east < west) return 'E'
  if (west <= tolerance && west < east) return 'W'
  return null
}

/** Make OCR text uniform: degree, minute and second marks become words, stray marks go, a comma before 1-2 digits is a decimal point. */
export function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[!¡¦~]/g, ' ')
    .replace(/[|]/g, 'l')
    .replace(/§/g, 'S')
    .replace(/\bdeg[a-z]*\.?/gi, ' deg ')
    .replace(/\bm[il1]n[a-z]*\.?/gi, ' min ')
    .replace(/\bsec[a-z]*\.?/gi, ' sec ')
    .replace(/(\d{1,2})\s*["″”]\s*(\d{1,2})\s*["″”]/g, '$1 min $2 sec') // 52" 10" is 52' 10": OCR turned the minute mark into a quote
    .replace(/(\d)\s*[°º˚]/g, '$1 deg ')
    .replace(/(\d)\s*['′’]\s*/g, '$1 min ')
    .replace(/(\d)\s*["″”]\s*/g, '$1 sec ')
    .replace(/["“”]\s*(?=\d)/g, ' ')
    .replace(/(?<![\w.])[58$]\s+(?=\d{1,3}\s+deg)/g, 'S ') // a lone 8, 5 or $ right before a bearing's degrees is an S that OCR misread
    .replace(/\s[-–—]\s*(?=[\d(])/g, ' ')
    .replace(/(?<=\bdeg|\bmin|\bsec)\s*[-–—]\s*/g, ' ')
    .replace(/\b(north|south)(?:east|west)\s+(?=[\d%?])/gi, '$1 ')
    .replace(/\b(north|south|n|s)\s*[-–—]\s*(?=[\d%?])/gi, '$1 ')
    .replace(/(\d)\s*%\s*[([{|]?\s*(?=deg)/gi, '$1 1/2 ') // OCR reads the half-degree sign (58½) as a percent sign, sometimes with a stray mark after it
    .replace(/½/g, ' 1/2')
    .replace(/¼/g, ' 1/4')
    .replace(/¾/g, ' 3/4')
}

const FRACTION = String.raw`(?:\s+\d+\/\d+)?`
const bearingPattern = () =>
  new RegExp(String.raw`\b(north|south|n|s)\b\.?\s*([\d%?]{1,3}${FRACTION})\s*(?:deg\s*)?(?:(\d{1,2})\s*(?:min\s*)?)?(?:(\d{1,2})\s*(?:sec\s*)?)?\s*([A-Za-z]{1,7})\b\.?`, 'gi')
/** Up to ~70 characters of words may sit between the bearing and the distance ("along the south margin of the road 100 feet"). */
const distancePattern = () => new RegExp(String.raw`^(?:[^\d]{0,70}?)(?:a\s+distance\s+of\s+)?(?:about\s+)?([\d,]*\d(?:\.\d+)?${FRACTION})\s*(?:feet|foot|ft|')`, 'i')

const toNumber = (s: string): number => {
  const fixed = s
    .replace(/(\d+)\s+(\d+)\/(\d+)/, (_, a: string, b: string, c: string) => String(Number(a) + Number(b) / Number(c)))
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
    .replace(/,/g, '')
  return Number(fixed)
}

/** Due north or south: "North 0 deg. 1963 feet", "due south 200 feet" (no east or west to read). */
const dueNorthSouthPattern = () => new RegExp(String.raw`\b(?:due\s+)?(north|south)\b\.?\s*(?:0+\s*(?:deg)?\.?)?\s+([\d,]*\d(?:\.\d+)?)\s*(?:feet|foot|ft)\b`, 'gi')

/** Every bearing-and-distance pair in the text, in order. */
export function extractCalls(text: string): Call[] {
  const t = normalizeText(text)
  const re = bearingPattern()
  const out: Array<Call & { at: number }> = []
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const ew = direction(m[5])
    if (!ew) continue
    const tail = t.slice(re.lastIndex, re.lastIndex + 220)
    // only the text of this call: up to the next "thence", semicolon or bearing
    const nextBearing = bearingPattern().exec(tail)
    const rest = (nextBearing ? tail.slice(0, nextBearing.index) : tail).split(/\bthence\b|;/i)[0]
    // "... reference pin at 30.38 feet, in all a distance of 1420.55 feet": the call's own length is the "in all" figure
    const inAll = /\bin all(?:\s+a distance of)?\s*([\d,]*\d(?:\.\d+)?)\s*(?:feet|foot|ft)/i.exec(rest)
    const dm = inAll ? { 0: inAll[0], 1: inAll[1], index: inAll.index } : distancePattern().exec(t.slice(re.lastIndex, re.lastIndex + 90))
    if (!dm) continue
    const unsure = /[%?]/.test(m[2])
    out.push({
      at: m.index,
      ns: m[1].toUpperCase().startsWith('N') ? 'N' : 'S',
      ew,
      deg: unsure ? null : toNumber(m[2]),
      min: Number(m[3] ?? 0),
      sec: Number(m[4] ?? 0),
      distance: toNumber(dm[1]),
      unsure,
      text: t.slice(m.index, re.lastIndex + dm[0].length).trim(),
    })
  }
  // due north / due south has no east or west, so the pattern above skips it; take those that were not already read as part of another bearing
  const due = dueNorthSouthPattern()
  for (let m = due.exec(t); m; m = due.exec(t)) {
    if (out.some((c) => m.index >= c.at && m.index < c.at + c.text.length)) continue
    const isZero = /^(?:due\s+)/i.test(m[0]) || /\b0/.test(m[0])
    if (!isZero) continue
    out.push({ at: m.index, ns: m[1].toUpperCase().startsWith('N') ? 'N' : 'S', ew: 'E', deg: 0, min: 0, sec: 0, distance: toNumber(m[2]), unsure: false, text: m[0].trim() })
  }
  return out.sort((a, b) => a.at - b.at).map(({ at: _at, ...call }) => call)
}

/**
 * A rectangle's opposite sides run the same way reversed. An unreadable bearing (a handwritten correction OCR read as "%") is
 * filled in from a call of about the same length that runs the other way, and marked as inferred so it gets checked.
 */
export function repairByReciprocal(calls: Call[]): Call[] {
  return calls.map((c, i) => {
    if (!c.unsure) return c
    const mate = calls.find((d, j) => j !== i && !d.unsure && Math.abs(d.distance - c.distance) / c.distance < 0.05 && d.ns !== c.ns && d.ew !== c.ew)
    if (!mate) return c
    return { ...c, deg: mate.deg, min: mate.min, sec: mate.sec, unsure: false, inferred: `bearing taken from the opposite side, ${mate.ns} ${mate.deg}° ${mate.ew}` }
  })
}

/** The boundary calls of one description: after the (true) point of beginning, before "containing", without parenthetical witness calls. */
/** The part of a description that holds its boundary calls: from "commencing" or "beginning" to "containing", without parentheses. */
function boundaryRegion(text: string): string {
  let t = text.replace(/\s+/g, ' ').replace(/§/g, 'S')
  const commencing = t.search(/\bcommencing\b/i)
  if (commencing >= 0) {
    t = t.slice(commencing)
    const tpob = t.search(/true\s+point\s+of\s+beginning|T\.?P\.?O\.?B/i)
    if (tpob > 0) t = t.slice(tpob)
  } else {
    const b = t.search(/\bbegin(?:ning)?\b/i)
    if (b >= 0) t = t.slice(b)
  }
  const end = t.search(/\bcontaining\b|\bcontains\b/i)
  if (end > 0) t = t.slice(0, end)
  return t.replace(/\([^)]*\)/g, ' ')
}

export function boundaryCalls(text: string): Call[] {
  return repairByReciprocal(extractCalls(boundaryRegion(text)))
}

/**
 * How many more bearings the text mentions than were read as calls. Every call has one "deg", so a positive number means a call the
 * reader could not parse was dropped (a noisy scan: "North Li} x deg. East 247 feet"). It can also be a tie bearing to a found rebar,
 * which is not a boundary call, so this is a hint to look, never a verdict.
 */
export function unreadBearings(text: string, calls: number): number {
  const degrees = (normalizeText(boundaryRegion(text)).match(/\bdeg\b/g) ?? []).length
  return Math.max(0, degrees - calls)
}

/** The acreage a description states ("containing 1.26 acres", "46-7/10 acres more or less"), or null. */
export function statedAcres(text: string): number | null {
  const m = /containing\s+(?:about\s+)?([\d.,]+)(?:[\s-]+(\d+)\/(\d+))?\s*(?:total\s+)?acres?/i.exec(text.replace(/\s+/g, ' ')) ?? /\b([\d.,]*\d)(?:[\s-]+(\d+)\/(\d+))?\s*(?:\+\/-\s*)?acres?\b/i.exec(text.replace(/\s+/g, ' '))
  if (!m) return null
  const whole = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(whole) ? whole + (m[2] ? Number(m[2]) / Number(m[3]) : 0) : null
}

const NUMBER_WORDS: Record<string, string> = { ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5' }

/**
 * Split a deed into its tracts or parcels ("TRACT 1:", "PARCEL NO. 2") and read each. A description with no such headings is one
 * tract. Pieces with fewer than two calls are dropped (a mention of "the Hood tract" is not a tract).
 */
export function readDescription(text: string): Tract[] {
  const flat = text.replace(/\s+/g, ' ')
  // A heading is "TRACT 1:" / "PARCEL NO. 2" in capitals, or "Parcel 2:" with a colon. A mention inside a sentence ("along the north line
  // of said Parcel 2 the following courses") must not split the description in half.
  const heading = String.raw`(?:(PARCEL|TRACT)\s+(?:NO\.?\s*)?(\d{1,2}|ONE|TWO|THREE|FOUR|FIVE)\b|(Parcel|Tract)\s+(?:No\.?\s*)?(\d{1,2}|One|Two|Three|Four|Five)\s*:)`
  const head = new RegExp(String.raw`\b${heading}`, 'g')
  const starts: Array<{ at: number; label: string }> = []
  for (let m = head.exec(flat); m; m = head.exec(flat)) {
    const kind = (m[1] ?? m[3]).toLowerCase() === 'parcel' ? 'Parcel' : 'Tract'
    const n = NUMBER_WORDS[(m[2] ?? m[4]).toUpperCase()] ?? (m[2] ?? m[4])
    starts.push({ at: m.index, label: `${kind} ${n}` })
  }
  const sections = starts.length >= 2 ? starts.map((s, i) => ({ label: s.label, text: flat.slice(s.at, starts[i + 1]?.at ?? flat.length) })) : [{ label: 'Description', text: flat }]
  return sections
    .map((s) => {
      const calls = boundaryCalls(s.text)
      return { label: s.label, calls, statedAcres: statedAcres(s.text), unreadBearings: unreadBearings(s.text, calls.length) }
    })
    .filter((t) => t.calls.length >= 2)
}
