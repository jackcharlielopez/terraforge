/**
 * Linework syntax: how a firm writes codes and marks where lines start, end and close.
 * Conventions genuinely differ (see PROJECT.md, "Standards research"), so this is data in the code book,
 * with presets for the documented ones:
 *  - TDOT: "+FN" starts a line, "FN" continues it, "-FN" ends it, "*FN" closes it; several lines may be open at once;
 *    "=" starts a free-text descriptor ("XUP=P/T/C"), so "/" is part of the descriptor, not a separator.
 *  - Civil 3D / BLM style: words after the code: "EP1 B" ... "EP1 E", "CC B, CC, CC, CC C".
 *  - This job: "/" separates several codes on one point, and END / BEG / CLO are optional hints.
 */
export interface LineworkSyntax {
  /** Separates several codes on one point ("GUTTER/EP/GAS"). Empty = a description is a single code. */
  separator: string
  /** Everything after this is a free-text descriptor, never read as codes ("XUP=P/T/C"). Empty = none. */
  descriptorDelimiter: string
  /** Whole words that start a new line / finish the line here / close it back to its start. Upper case. */
  begin: string[]
  end: string[]
  close: string[]
  /** One-character markers written directly before a code ("+FN", "-FN", "*FN"). Empty = none. */
  beginPrefix: string
  endPrefix: string
  closePrefix: string
  /**
   * true: lines exist only where the file marks them, and a marked line stays open across any number of other
   * shots (several lines can be open at once). false: lines are inferred from codes and shot order, and the
   * markers above are optional hints.
   */
  explicitLines: boolean
}

export const DEFAULT_SYNTAX: LineworkSyntax = {
  separator: '/',
  descriptorDelimiter: '',
  begin: ['BEG', 'BEGIN'],
  end: ['END'],
  close: ['CLO', 'CLS', 'CLOSE'],
  beginPrefix: '',
  endPrefix: '',
  closePrefix: '',
  explicitLines: false,
}

export interface SyntaxPreset {
  id: string
  label: string
  syntax: LineworkSyntax
}

export const SYNTAX_PRESETS: SyntaxPreset[] = [
  { id: 'terraforge', label: 'This job: / separates codes; END, BEG, CLO hints', syntax: DEFAULT_SYNTAX },
  {
    id: 'tdot',
    label: 'TDOT: +start  -end  *close, = starts a descriptor',
    syntax: { ...DEFAULT_SYNTAX, separator: '', descriptorDelimiter: '=', begin: [], end: [], close: [], beginPrefix: '+', endPrefix: '-', closePrefix: '*', explicitLines: true },
  },
  {
    id: 'words',
    label: 'Begin / End / Close words: EP1 B … EP1 E (Civil 3D, BLM style)',
    syntax: { ...DEFAULT_SYNTAX, begin: ['B'], end: ['E'], close: ['C'], explicitLines: true },
  },
]

/** The preset a syntax equals, or null when it has been customised. */
export function presetIdOf(s: LineworkSyntax): string | null {
  const key = JSON.stringify(normalizeSyntax(s))
  return SYNTAX_PRESETS.find((p) => JSON.stringify(normalizeSyntax(p.syntax)) === key)?.id ?? null
}

/** Fill gaps with defaults and tidy values; the single place that decides what a stored syntax means. */
export function normalizeSyntax(s: Partial<LineworkSyntax> | undefined): LineworkSyntax {
  const words = (w: unknown, fallback: string[]) =>
    Array.isArray(w) ? [...new Set(w.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toUpperCase()).filter((x) => x !== '' && !/\s/.test(x) && x.length <= 12))] : fallback
  const mark = (v: unknown, fallback: string) => (typeof v === 'string' ? v.trim().slice(0, 3) : fallback)
  const d = DEFAULT_SYNTAX
  return {
    separator: typeof s?.separator === 'string' ? s.separator.slice(0, 3) : d.separator,
    descriptorDelimiter: mark(s?.descriptorDelimiter, d.descriptorDelimiter),
    begin: words(s?.begin, d.begin),
    end: words(s?.end, d.end),
    close: words(s?.close, d.close),
    beginPrefix: mark(s?.beginPrefix, d.beginPrefix),
    endPrefix: mark(s?.endPrefix, d.endPrefix),
    closePrefix: mark(s?.closePrefix, d.closePrefix),
    explicitLines: typeof s?.explicitLines === 'boolean' ? s.explicitLines : d.explicitLines,
  }
}

/** Problems with a syntax that would make descriptions ambiguous (returned as plain sentences). */
export function syntaxProblems(s: LineworkSyntax): string[] {
  const out: string[] = []
  const marks = [s.separator, s.descriptorDelimiter, s.beginPrefix, s.endPrefix, s.closePrefix].filter((m) => m !== '')
  if (new Set(marks).size !== marks.length) out.push('The separator, descriptor marker and begin/end/close prefixes must all be different.')
  const words = [...s.begin, ...s.end, ...s.close]
  if (new Set(words).size !== words.length) out.push('A word cannot be both a begin, end and close word.')
  return out
}
