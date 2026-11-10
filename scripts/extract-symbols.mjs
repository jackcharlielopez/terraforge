// Reads the firm's legend DXF and writes src/data/symbols.json: the symbol blocks as plain primitives that an R12 DXF can hold
// (LINE, CIRCLE, ARC, POLYLINE with bulge and width, SOLID, TEXT; ellipses become polylines, attributes are dropped).
// Usage: node scripts/extract-symbols.mjs "<legend.dxf>" [out.json]
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const DxfParser = require('dxf-parser')

const [src, out = new URL('../src/data/symbols.json', import.meta.url).pathname] = process.argv.slice(2)
if (!src) throw new Error('usage: node scripts/extract-symbols.mjs <legend.dxf> [out.json]')

/** Block name -> what the legend calls it, from the legend sheet (right-hand column). */
const WANTED = ['SPT4', 'SPT5', 'SPT7', 'SPT13', 'SPT19', 'SPT25', 'SPT39', 'SPT41', 'SPT48', 'SPT49', 'SPT107', 'SPT138', 'SPT214', 'CG101', 'CG152', 'CG161', 'SSWR-13', 'STRM-18', 'NGAS-01', 'NGAS-04', 'POWR-02', 'COMM-02', 'WATR-02']
const dxf = new (DxfParser.default ?? DxfParser)().parseSync(new TextDecoder('windows-1252').decode(fs.readFileSync(src)))
const r = (n) => Math.round(n * 1e5) / 1e5
const deg = (rad) => r((rad * 180) / Math.PI)
/** 0 = by block (takes the colour of the layer it is inserted on), anything else is a fixed colour; by layer is left out. */
const colour = (e) => (e.colorIndex === undefined || e.colorIndex === 256 ? undefined : e.colorIndex)

function convert(e) {
  const c = colour(e)
  const base = c === undefined ? {} : { k: c }
  switch (e.type) {
    case 'LINE': return [{ t: 'L', a: [r(e.vertices[0].x), r(e.vertices[0].y)], b: [r(e.vertices[1].x), r(e.vertices[1].y)], ...base }]
    case 'CIRCLE': return [{ t: 'C', c: [r(e.center.x), r(e.center.y)], r: r(e.radius), ...base }]
    case 'ARC': return [{ t: 'A', c: [r(e.center.x), r(e.center.y)], r: r(e.radius), s: deg(e.startAngle), e: deg(e.endAngle), ...base }]
    case 'LWPOLYLINE': return [{ t: 'P', v: e.vertices.map((p) => [r(p.x), r(p.y), r(p.bulge ?? 0)]), closed: !!e.shape, ...(e.width ? { w: r(e.width) } : {}), ...base }]
    case 'SOLID': return [{ t: 'S', p: e.points.map((p) => [r(p.x), r(p.y)]), ...base }]
    case 'TEXT': return [{ t: 'T', p: [r(e.startPoint.x), r(e.startPoint.y)], h: r(e.textHeight), s: e.text, ha: e.halign ?? 0, va: e.valign ?? 0, ...(e.endPoint ? { q: [r(e.endPoint.x), r(e.endPoint.y)] } : {}), ...base }]
    case 'ELLIPSE': {
      const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y
      const a = Math.hypot(mx, my), b = a * e.axisRatio, rot = Math.atan2(my, mx)
      if (Math.abs(e.axisRatio - 1) < 1e-9 && Math.abs(e.endAngle - e.startAngle - 2 * Math.PI) < 1e-6) return [{ t: 'C', c: [r(e.center.x), r(e.center.y)], r: r(a), ...base }]
      const full = Math.abs(e.endAngle - e.startAngle - 2 * Math.PI) < 1e-6, N = 32
      const v = []
      for (let i = 0; i <= (full ? N - 1 : N); i++) {
        const t = e.startAngle + ((e.endAngle - e.startAngle) * i) / N
        v.push([r(e.center.x + a * Math.cos(t) * Math.cos(rot) - b * Math.sin(t) * Math.sin(rot)), r(e.center.y + a * Math.cos(t) * Math.sin(rot) + b * Math.sin(t) * Math.cos(rot)), 0])
      }
      return [{ t: 'P', v, closed: full, ...base }]
    }
    case 'ATTDEF': // a constant, visible attribute is just text (the W, G or SS drawn inside a symbol); a prompted one is a label slot and is dropped
      return e.constant && !e.invisible && e.text ? [{ t: 'T', p: [r(e.startPoint.x), r(e.startPoint.y)], h: r(e.textHeight), s: e.text, ha: e.horizontalJustification ?? 0, va: e.verticalJustification ?? 0, ...(e.endPoint ? { q: [r(e.endPoint.x), r(e.endPoint.y)] } : {}), ...base }] : []
    default: return [] // nested INSERT and anything else is dropped
  }
}

const symbols = {}
for (const name of WANTED) {
  const b = dxf.blocks[name]
  if (!b) { console.warn('missing block', name); continue }
  const entities = b.entities.flatMap(convert)
  const dropped = b.entities.filter((e) => convert(e).length === 0).map((e) => e.type)
  symbols[name] = entities
  console.log(name.padEnd(8), entities.length, 'primitives', dropped.length ? '(dropped ' + [...new Set(dropped)].join(',') + ')' : '')
}
fs.writeFileSync(out, JSON.stringify(symbols))
console.log('wrote', out, fs.statSync(out).size, 'bytes')
