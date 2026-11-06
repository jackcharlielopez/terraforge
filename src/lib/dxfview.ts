/**
 * Read any .dxf into simple shapes the preview can draw, so a generated drawing can be compared
 * with a finished one. Draws: POINT, LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT and the
 * contents of INSERT blocks (translated/scaled/rotated). Paper space is ignored. Other entity types
 * (leaders, images, tables, hatches, splines…) are not drawn, and the parser silently drops some,
 * so treat the picture as "what is drawable", not a complete audit of the file.
 */
export interface RefLine {
  layer: string
  pts: Array<[number, number]>
  closed: boolean
}
export interface RefLayer {
  name: string
  /** AutoCAD colour index of the layer. */
  aci: number
  count: number
}
export interface RefShapes {
  lines: RefLine[]
  circles: Array<{ layer: string; x: number; y: number; r: number }>
  points: Array<{ layer: string; x: number; y: number }>
  texts: Array<{ layer: string; x: number; y: number; h: number; text: string }>
  /** Top-level lines/polylines only, in their original coordinates (blocks are not expanded): used for comparison. */
  edges: RefLine[]
  layers: RefLayer[]
  extent: { minX: number; maxX: number; minY: number; maxY: number } | null
  /** Entities seen in model space that were not drawn, by type. */
  notDrawn: Record<string, number>
  paperSpaceIgnored: number
  /** POINT entities sitting at exactly (0,0): usually drafting leftovers. They are left out of the fit so they don't stretch the view. */
  atOrigin: number
}

interface Pt {
  x: number
  y: number
}
/** The slice of dxf-parser's output this file relies on. */
interface Ent {
  type: string
  layer?: string
  inPaperSpace?: boolean
  vertices?: Pt[]
  shape?: boolean
  position?: Pt
  startPoint?: Pt
  center?: Pt
  radius?: number
  startAngle?: number
  endAngle?: number
  text?: string
  textHeight?: number
  height?: number
  name?: string
  xScale?: number
  yScale?: number
  rotation?: number
}
interface Parsed {
  entities: Ent[]
  blocks?: Record<string, { entities?: Ent[]; position?: Pt }>
  tables?: { layer?: { layers?: Record<string, { colorIndex?: number }> } }
}

const MAX_BLOCK_DEPTH = 4
const MAX_ARC_STEP = Math.PI / 24

/**
 * Decode a DXF file's bytes. AutoCAD 2007+ (AC1021 and later) writes UTF-8; older files use the code
 * page named in the header, which for our purposes is Windows-1252. Getting this wrong turns a degree
 * sign into "Â°".
 */
export function decodeDxf(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 4096))
  const version = /\$ACADVER\s+1\s+(AC\d+)/.exec(head)?.[1]
  const utf8 = version !== undefined && version >= 'AC1021'
  return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(u8)
}

export async function readDxf(text: string): Promise<RefShapes> {
  const { default: DxfParser } = await import('dxf-parser')
  const parsed = new DxfParser().parseSync(text) as unknown as Parsed | null
  if (!parsed || !Array.isArray(parsed.entities)) throw new Error('This does not look like a DXF file.')
  return shapesFromParsed(parsed, scanAttribs(text))
}

export function shapesFromParsed(parsed: Parsed, attribs: RefShapes['texts'] = []): RefShapes {
  const out: RefShapes = { lines: [], circles: [], points: [], texts: [...attribs], edges: [], layers: [], extent: null, notDrawn: {}, paperSpaceIgnored: 0, atOrigin: 0 }
  const counts = new Map<string, number>()
  const bump = (layer: string) => counts.set(layer, (counts.get(layer) ?? 0) + 1)

  for (const t of attribs) bump(t.layer)

  const draw = (e: Ent, m: Matrix, top: boolean, depth: number, parentLayer: string) => {
    // Entities inside blocks are usually on layer "0" (inherit the INSERT's layer).
    const layer = e.layer && e.layer !== '0' ? e.layer : parentLayer
    switch (e.type) {
      case 'POINT':
        if (e.position) out.points.push({ layer, ...apply(m, e.position) })
        break
      case 'LINE':
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const v = (e.vertices ?? []).map((p) => apply(m, p))
        if (v.length < 2) return
        const line: RefLine = { layer, pts: v.map((p) => [p.x, p.y]), closed: e.type !== 'LINE' && e.shape === true }
        out.lines.push(line)
        if (top) out.edges.push(line)
        break
      }
      case 'CIRCLE':
        if (e.center && e.radius !== undefined) out.circles.push({ layer, ...apply(m, e.center), r: e.radius * Math.abs(m.sx) })
        break
      case 'ARC': {
        if (!e.center || e.radius === undefined) return
        const a0 = e.startAngle ?? 0
        let a1 = e.endAngle ?? 0
        if (a1 <= a0) a1 += Math.PI * 2
        const steps = Math.max(2, Math.ceil((a1 - a0) / MAX_ARC_STEP))
        const pts: Array<[number, number]> = []
        for (let i = 0; i <= steps; i++) {
          const a = a0 + ((a1 - a0) * i) / steps
          const p = apply(m, { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) })
          pts.push([p.x, p.y])
        }
        out.lines.push({ layer, pts, closed: false })
        break
      }
      case 'TEXT':
      case 'MTEXT': {
        const at = e.type === 'TEXT' ? e.startPoint : e.position
        if (!at || !e.text) return
        out.texts.push({ layer, ...apply(m, at), h: (e.type === 'TEXT' ? e.textHeight : e.height) ?? 1, text: cleanText(e.text) })
        break
      }
      case 'INSERT': {
        const block = e.name ? parsed.blocks?.[e.name] : undefined
        if (!block?.entities || !e.position || depth >= MAX_BLOCK_DEPTH) return
        const base = block.position ?? { x: 0, y: 0 }
        const inner = insertMatrix(m, e, base)
        for (const child of block.entities) draw(child, inner, false, depth + 1, layer)
        return // the INSERT itself is not counted as an entity of its own
      }
      default:
        if (top) out.notDrawn[e.type] = (out.notDrawn[e.type] ?? 0) + 1
        return
    }
    if (top) bump(layer)
  }

  for (const e of parsed.entities) {
    if (e.inPaperSpace) {
      out.paperSpaceIgnored++
      continue
    }
    // INSERTs are counted under their own layer so they show up in the layer list.
    if (e.type === 'INSERT') bump(e.layer ?? '0')
    draw(e, IDENTITY, true, 0, e.layer ?? '0')
  }

  const layerTable = parsed.tables?.layer?.layers ?? {}
  out.layers = [...counts]
    .map(([name, count]) => ({ name, count, aci: Math.abs(layerTable[name]?.colorIndex ?? 7) || 7 }))
    .sort((a, b) => a.name.localeCompare(b.name))
  out.atOrigin = out.points.filter((p) => p.x === 0 && p.y === 0).length
  out.extent = extentOf(out)
  return out
}

/**
 * dxf-parser drops ATTRIB entities (where point number / elevation / description live in a
 * survey drawing), so read those straight from the text: model-space ATTRIBs in ENTITIES only.
 */
export function scanAttribs(text: string): RefShapes['texts'] {
  const lines = text.split(/\r\n|\n|\r/)
  const out: RefShapes['texts'] = []
  let inEntities = false
  let cur: Record<string, string> | null = null
  const flush = () => {
    if (cur && cur.type === 'ATTRIB' && cur['67'] !== '1' && cur['1']) {
      const centred = cur['72'] === '1' || cur['72'] === '4' || cur['72'] === '2'
      const x = Number(centred && cur['11'] !== undefined ? cur['11'] : cur['10'])
      const y = Number(centred && cur['21'] !== undefined ? cur['21'] : cur['20'])
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ layer: cur['8'] ?? '0', x, y, h: Number(cur['40']) || 1, text: cleanText(cur['1']) })
    }
    cur = null
  }
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim()
    const value = lines[i + 1].trim()
    if (code === '0') {
      flush()
      if (value === 'SECTION') continue
      if (value === 'ENDSEC') {
        inEntities = false
        continue
      }
      if (inEntities) cur = { type: value }
    } else if (code === '2' && !inEntities && lines[i - 2]?.trim() === '0' && lines[i - 1]?.trim() === 'SECTION') {
      inEntities = value === 'ENTITIES'
    } else if (cur && cur.type === 'ATTRIB' && cur[code] === undefined) {
      // keep the first of each group code (ATTRIB repeats 10/20/11/21 for its two points: first is the insert point)
      cur[code] = lines[i + 1].replace(/\r$/, '')
    }
  }
  flush()
  return out
}

/** Strip MTEXT formatting codes down to readable text. */
export function cleanText(s: string): string {
  return s
    .replace(/%%d/gi, '°')
    .replace(/%%p/gi, '±')
    .replace(/%%c/gi, '⌀')
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---- tiny 2D affine transform (scale, rotate, translate) ----
interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  /** x scale magnitude, for circle radii */
  sx: number
}
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, sx: 1 }

function apply(m: Matrix, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

function insertMatrix(parent: Matrix, ins: Ent, base: Pt): Matrix {
  const sx = ins.xScale || 1
  const sy = ins.yScale || 1
  const rot = ((ins.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const pos = ins.position ?? { x: 0, y: 0 }
  // local = R * S * (p - base) + pos, then the parent transform
  const local: Matrix = {
    a: cos * sx,
    b: sin * sx,
    c: -sin * sy,
    d: cos * sy,
    e: pos.x - (cos * sx * base.x - sin * sy * base.y),
    f: pos.y - (sin * sx * base.x + cos * sy * base.y),
    sx: Math.abs(sx),
  }
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    e: parent.a * local.e + parent.c * local.f + parent.e,
    f: parent.b * local.e + parent.d * local.f + parent.f,
    sx: parent.sx * local.sx,
  }
}

function extentOf(s: RefShapes): RefShapes['extent'] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  for (const l of s.lines) for (const [x, y] of l.pts) add(x, y)
  for (const c of s.circles) { add(c.x - c.r, c.y - c.r); add(c.x + c.r, c.y + c.r) }
  for (const p of s.points) if (!(p.x === 0 && p.y === 0)) add(p.x, p.y)
  return minX === Infinity ? null : { minX, maxX, minY, maxY }
}
