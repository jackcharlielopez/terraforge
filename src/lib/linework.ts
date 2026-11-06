import { continueLines } from './continue.ts'
import { fillGaps } from './gapfill.ts'
import { reassignSpurs, removeSkewedStubs, resolveLayerDuplicates } from './layerrules.ts'
import type { CodeDef, PointMatch, Polyline, SurveyPoint, Vertex } from './types.ts'

export interface LineworkOptions {
  /** Start a new line when the next point is farther than this from the previous (feet/units). 0 = no limit. */
  maxGap: number
  /**
   * How many shots of other kinds may come between two shots of the same line before it breaks.
   * 0 = the line runs only through shots taken one after another. Infinity = join same-code points anywhere.
   */
  maxSkip?: number
  /**
   * The file marks its own lines (TDOT's "+FN … FN … -FN", Civil 3D's "EP1 B … EP1 E"): a line exists only from a begin
   * marker to its end/close marker, stays open across any number of other shots (several lines may be open at once),
   * and gap and discipline limits do not apply. Unmarked points are left as points.
   */
  explicitLines?: boolean
  /**
   * After the lines are built, join leftover nearby points of the same layer by position, up to this distance (0 or unset = off).
   * Not used with explicit markers: there the file says where lines go.
   */
  fillGaps?: number
  /**
   * How lines are found. 'order' (default): from shot order and codes. 'position': from where the points are, ignoring the
   * numbers, for files whose numbering is scrambled. Position mode uses `fillGaps` as its distance (40 when that is 0).
   */
  joinBy?: 'order' | 'position'
  /** false leaves out the guessing steps (joining line ends that continue each other, capping), for telling guesses from rules. */
  guess?: boolean
}

export const DEFAULT_LINEWORK: LineworkOptions = { maxGap: 100, maxSkip: 0, fillGaps: 0 }

/**
 * Connect points that share a code, in point-number order.
 *
 * - Only codes with `connect: true` produce lines; codes sharing a `line` key chain together.
 * - Offset shots (3'O/S) are never connected.
 * - A line runs through shots of one kind taken one after another: it breaks when another kind of shot
 *   comes between (more than `maxSkip` of them; codes can override this, e.g. ditch banks zig-zag).
 * - Control tokens in a description steer it: `END` finishes the line after this point, `BEG` starts a new
 *   one here, `CLO` closes it back to its first point. A number after a code (`BLDG2`) makes it a separate line.
 * - A gap larger than `maxGap` starts a new line, so unrelated runs don't join up.
 *
 * The file carries no explicit connectivity, so this is an approximation of what a drafter
 * would draw (see reference/DXF-NOTES.md).
 */
function chain(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  options: LineworkOptions = DEFAULT_LINEWORK,
): Polyline[] {
  const order = points.map((_, i) => i).sort((a, b) => compareNo(points[a].no, points[b].no) || a - b)

  interface Chain {
    layer: string
    closed: boolean
    vertices: Polyline['vertices']
    /** Position (in point order) of the last shot added. */
    lastPos: number
    mayCross: boolean
  }
  const maxSkip = options.maxSkip ?? Infinity
  const explicit = options.explicitLines === true
  const gapFor = (def: CodeDef) => def.maxGap ?? options.maxGap
  const skipFor = (def: CodeDef) => def.maxSkip ?? maxSkip
  const active = new Map<string, Chain>()
  const out: Polyline[] = []
  const emit = (key: string, layer: string, closed: boolean, vertices: Vertex[], mayCross: boolean) => {
    // A closing shot taken on top of the first point would repeat it: keep the polygon, drop the repeat.
    const first = vertices[0]
    const last = vertices[vertices.length - 1]
    if (closed && vertices.length > 3 && Math.hypot(last.e - first.e, last.n - first.n) < 0.001) vertices = vertices.slice(0, -1)
    if (vertices.length >= 2) out.push({ layer, key, vertices, closed: closed && vertices.length >= 3, ...(mayCross ? { mayCross: true } : {}) })
  }
  const finish = (key: string) => {
    const chain = active.get(key)
    if (!chain) return
    active.delete(key)
    emit(key, chain.layer, chain.closed, chain.vertices, chain.mayCross)
  }

  for (const [pos, i] of order.entries()) {
    const p = points[i]
    const m = matches[i]
    if (m.offset) continue

    const keysHere: string[] = []
    const flagsHere = new Map<string, { end: boolean; close: boolean }>()
    for (const code of m.codes) {
      const def = defs.get(code)
      if (!def || !def.connect) continue
      const suffix = m.lineIds[code]
      const key = (def.line ?? def.code) + (suffix ? '#' + suffix : '')
      if (keysHere.includes(key)) continue
      keysHere.push(key)
      const ctl = m.controls[code]
      const begin = m.begin || ctl?.begin === true
      const close = m.close || ctl?.close === true
      flagsHere.set(key, { end: m.end || ctl?.end === true, close })

      let chain = active.get(key)
      const last = chain?.vertices[chain.vertices.length - 1]
      const gap = gapFor(def)
      // With explicit markers the file decides where lines start and stop: no gap or discipline limits.
      const tooFar = !explicit && chain && last && gap > 0 && Math.hypot(p.e - last.e, p.n - last.n) > gap
      const interrupted = !explicit && chain !== undefined && pos - chain.lastPos - 1 > skipFor(def)
      if (chain && (tooFar || interrupted || begin)) {
        finish(key)
        chain = undefined
      }
      if (!chain && explicit && !begin) continue // nothing marked a line here: this shot stays a point
      if (!chain) {
        chain = { layer: def.layer, closed: def.closed === true || (suffix !== undefined && def.closeNumbered === true), vertices: [], lastPos: pos, mayCross: def.mayCross === true }
        active.set(key, chain)
      }
      chain.vertices.push({ e: p.e, n: p.n, z: p.z })
      chain.lastPos = pos
    }

    for (const [key, f] of flagsHere) {
      if (f.close) {
        const c = active.get(key)
        if (c) c.closed = true
      }
      if (f.end || f.close) finish(key)
    }
  }

  for (const key of [...active.keys()]) finish(key)

  return out
}

/** Numeric point numbers sort numerically; anything else falls back to text order. */
export function compareNo(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Points farther than this from the line they should run alongside are left to the normal rules. */
const ALONGSIDE_MAX_OFFSET = 60

/**
 * Build the lines (see `chain`), then for codes that run alongside another line, replace their
 * shot-order chains with bank lines: each point goes to the side of the nearest stretch of the centreline
 * (built from its points, see `pointSpines`), and each side is run in order along it. A bank cannot cross the
 * line it runs beside.
 */
function withBanks(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  options: LineworkOptions = DEFAULT_LINEWORK,
): Polyline[] {
  const base = chain(points, matches, defs, options)
  const banked = [...defs.values()].filter((d) => d.connect && d.alongside)
  if (banked.length === 0) return base

  let working = matches
  const banks: Polyline[] = []
  for (const def of banked) {
    const spineDef = defs.get(def.alongside!.toUpperCase())
    if (!spineDef) continue
    const spineKey = spineDef.line ?? spineDef.code
    // The centreline comes from its points, ordered along the ditch; the shot-order lines are only a fallback
    // (too few centreline points to make a corridor).
    let spines = pointSpines(points, matches, spineDef, options.maxGap)
    if (spines.length === 0) spines = base.filter((l) => l.key === spineKey && !l.closed)
    if (spines.length === 0) continue
    const gap = def.maxGap ?? options.maxGap

    // which spine, which side, how far along, for every point of this code
    const groups = new Map<string, Array<{ idx: number; along: number }>>()
    const taken = new Set<number>()
    points.forEach((p, idx) => {
      const m = matches[idx]
      if (m.offset || !m.codes.includes(def.code)) return
      let best: { d: number; spine: number; side: number; along: number } | null = null
      spines.forEach((sp, si) => {
        let cum = 0
        for (let i = 1; i < sp.vertices.length; i++) {
          const a = sp.vertices[i - 1], b = sp.vertices[i]
          const dx = b.e - a.e, dy = b.n - a.n
          const len = Math.hypot(dx, dy)
          if (len === 0) continue
          const t = Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy) / (len * len)))
          const d = Math.hypot(p.e - (a.e + t * dx), p.n - (a.n + t * dy))
          if (!best || d < best.d) best = { d, spine: si, side: dx * (p.n - a.n) - dy * (p.e - a.e) >= 0 ? 1 : -1, along: cum + t * len }
          cum += len
        }
      })
      if (!best || (best as { d: number }).d > ALONGSIDE_MAX_OFFSET) return
      const b = best as { spine: number; side: number; along: number }
      const key = `${b.spine}:${b.side}`
      groups.set(key, [...(groups.get(key) ?? []), { idx, along: b.along }])
      taken.add(idx)
    })
    if (taken.size === 0) continue

    for (const members of groups.values()) {
      members.sort((x, y) => x.along - y.along)
      let run: Vertex[] = []
      const flush = () => {
        if (run.length >= 2) banks.push({ layer: def.layer, key: `${def.code}-bank`, closed: false, vertices: run, ...(def.mayCross ? { mayCross: true } : {}) })
        run = []
      }
      for (const { idx } of members) {
        const p = points[idx]
        const last = run[run.length - 1]
        if (last && gap > 0 && Math.hypot(p.e - last.e, p.n - last.n) > gap) flush()
        run.push({ e: p.e, n: p.n, z: p.z })
      }
      flush()
    }
    // the points now on bank lines no longer take part in the shot-order chains for this code
    working = working.map((m, idx) => (taken.has(idx) ? { ...m, codes: m.codes.filter((c) => c !== def.code) } : m))
  }
  if (banks.length === 0) return base
  // The centreline itself is drawn in position order too: shot order zig-zags across a ditch and the sharp-turn rule
  // then deletes real stretches of it.
  const centreKeys = new Set<string>()
  const centres: Polyline[] = []
  for (const def of banked) {
    const spineDef = defs.get(def.alongside!.toUpperCase())
    if (!spineDef) continue
    const sp = pointSpines(points, matches, spineDef, options.maxGap, true)
    if (sp.length === 0) continue
    centreKeys.add(spineDef.line ?? spineDef.code)
    centres.push(...sp.filter((s) => !centres.some((c) => c.key === s.key && c.vertices[0] === s.vertices[0])))
  }
  const rest = chain(points, working, defs, options).filter((l) => l.closed || !centreKeys.has(l.key))
  return [...rest, ...centres, ...banks]
}

/**
 * Build the lines: shot order and codes first (`chain`), ditch banks beside their centreline (`withBanks`), then
 * leftover nearby points of the same layer joined by position (`fillGaps`).
 */
export function buildLinework(
  points: SurveyPoint[],
  matches: PointMatch[],
  defs: Map<string, CodeDef>,
  options: LineworkOptions = DEFAULT_LINEWORK,
): Polyline[] {
  if (options.explicitLines) return withBanks(points, matches, defs, options)
  let lines: Polyline[]
  if (options.joinBy === 'position') {
    // The numbers are not trusted: start from nothing and let position decide.
    const distance = options.fillGaps && options.fillGaps > 0 ? options.fillGaps : POSITION_DEFAULT_GAP
    lines = fillGaps(points, matches, defs, [], distance)
  } else {
    lines = fillGaps(points, matches, defs, withBanks(points, matches, defs, options), options.fillGaps ?? 0)
  }
  // Then decide which layer each line belongs on (spurs off a road edge, the same segment claimed by two layers) and
  // drop short skewed stubs on man-made layers.
  const placed = reassignSpurs(points, matches, defs, lines)
  const continued = options.guess === false ? placed : continueLines(points, matches, defs, placed)
  return removeSkewedStubs(defs, resolveLayerDuplicates(defs, continued))
}

/** Distance used when joining by position alone and no other distance has been set. */
const POSITION_DEFAULT_GAP = 40


/**
 * The centreline a bank runs beside, built from the centreline POINTS rather than from shot order (the crew zig-zags across a ditch, so
 * the order of the centreline shots says little about where the ditch goes). Points are grouped into corridors by proximity, then
 * each corridor is walked from one end: start at the extreme point along the corridor's long axis and keep stepping to the nearest unvisited
 * point. Fewer than two points in a group makes no spine.
 */
function pointSpines(points: SurveyPoint[], matches: PointMatch[], spineDef: CodeDef, defaultGap: number, tight = false): Polyline[] {
  const idx: number[] = []
  points.forEach((_, i) => {
    if (!matches[i].offset && matches[i].codes.includes(spineDef.code)) idx.push(i)
  })
  if (idx.length < 2) return []
  let link = spineDef.maxGap ?? defaultGap
  if (tight) {
    // Drawn centreline: break where the points are much further apart than they usually are along this feature,
    // so two separate runs of the same code are not joined into one line.
    const nn = idx
      .map((a) => Math.min(...idx.filter((b) => b !== a).map((b) => Math.hypot(points[a].e - points[b].e, points[a].n - points[b].n))))
      .sort((x, y) => x - y)
    link = Math.min(link, Math.max(3 * nn[Math.floor(nn.length / 2)], 1))
  }
  // group by single linkage within `link`
  const group = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while ((group.get(r) ?? r) !== r) r = group.get(r)!
    return r
  }
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const pa = points[idx[a]], pb = points[idx[b]]
      if (Math.hypot(pa.e - pb.e, pa.n - pb.n) <= link) group.set(find(a), find(b))
    }
  }
  const clusters = new Map<number, number[]>()
  idx.forEach((_, a) => clusters.set(find(a), [...(clusters.get(find(a)) ?? []), idx[a]]))
  const out: Polyline[] = []
  for (const members of clusters.values()) {
    if (members.length < 2) continue
    // long axis of the group
    const mx = members.reduce((t, i) => t + points[i].e, 0) / members.length
    const my = members.reduce((t, i) => t + points[i].n, 0) / members.length
    let sxx = 0, syy = 0, sxy = 0
    for (const i of members) {
      sxx += (points[i].e - mx) ** 2
      syy += (points[i].n - my) ** 2
      sxy += (points[i].e - mx) * (points[i].n - my)
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    const ux = Math.cos(ang), uy = Math.sin(ang)
    const along = (i: number) => (points[i].e - mx) * ux + (points[i].n - my) * uy
    const left = new Set(members)
    let cur = members.reduce((best, i) => (along(i) < along(best) ? i : best), members[0])
    const path = [cur]
    left.delete(cur)
    while (left.size > 0) {
      let next = -1
      let bd = Infinity
      for (const j of left) {
        const d = Math.hypot(points[j].e - points[cur].e, points[j].n - points[cur].n)
        if (d < bd) {
          bd = d
          next = j
        }
      }
      path.push(next)
      left.delete(next)
      cur = next
    }
    out.push({
      layer: spineDef.layer,
      key: spineDef.line ?? spineDef.code,
      closed: false,
      vertices: path.map((i) => ({ e: points[i].e, n: points[i].n, z: points[i].z })),
    })
  }
  return out
}
