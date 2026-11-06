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
}

export interface Tract {
  label: string
  calls: Call[]
  /** The acreage the description states, if it states one. */
  statedAcres: number | null
}

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
    .replace(/(\d)\s*[°º˚]/g, '$1 deg ')
    .replace(/(\d)\s*['′’]\s*/g, '$1 min ')
    .replace(/(\d)\s*["″”]\s*/g, '$1 sec ')
    .replace(/["“”]\s*(?=\d)/g, ' ')
    .replace(/\s[-–—]\s*(?=[\d(])/g, ' ')
    .replace(/(?<=\bdeg|\bmin|\bsec)\s*[-–—]\s*/g, ' ')
    .replace(/\b(north|south)(?:east|west)\s+(?=[\d%?])/gi, '$1 ')
    .replace(/\b(north|south|n|s)\s*[-–—]\s*(?=[\d%?])/gi, '$1 ')
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

/** Every bearing-and-distance pair in the text, in order. */
export function extractCalls(text: string): Call[] {
  const t = normalizeText(text)
  const re = bearingPattern()
  const out: Call[] = []
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const ew = direction(m[5])
    if (!ew) continue
    const after = t.slice(re.lastIndex, re.lastIndex + 90)
    const dm = distancePattern().exec(after)
    if (!dm) continue
    const unsure = /[%?]/.test(m[2])
    out.push({
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
  return out
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
    return { ...c, deg: mate.deg, min: mate.min, sec: mate.sec, unsure: false, inferred: `the opposite side, ${mate.ns} ${mate.deg}° ${mate.ew}` }
  })
}

/** The boundary calls of one description: after the (true) point of beginning, before "containing", without parenthetical witness calls. */
export function boundaryCalls(text: string): Call[] {
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
  t = t.replace(/\([^)]*\)/g, ' ')
  return repairByReciprocal(extractCalls(t))
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
  const head = /\b(?:PARCEL|TRACT)\s+(?:NO\.?\s*)?(\d{1,2}|ONE|TWO|THREE|FOUR|FIVE)\b/gi
  const starts: Array<{ at: number; label: string }> = []
  for (let m = head.exec(flat); m; m = head.exec(flat)) {
    const n = NUMBER_WORDS[m[1].toUpperCase()] ?? m[1]
    starts.push({ at: m.index, label: `${m[0].toLowerCase().startsWith('parcel') ? 'Parcel' : 'Tract'} ${n}` })
  }
  const sections = starts.length >= 2 ? starts.map((s, i) => ({ label: s.label, text: flat.slice(s.at, starts[i + 1]?.at ?? flat.length) })) : [{ label: 'Description', text: flat }]
  return sections
    .map((s) => ({ label: s.label, calls: boundaryCalls(s.text), statedAcres: statedAcres(s.text) }))
    .filter((t) => t.calls.length >= 2)
}
