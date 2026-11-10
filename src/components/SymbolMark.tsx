import { aciToHex } from '../lib/aci.ts'
import { SYMBOLS } from '../lib/symbols.ts'
import type { Primitive } from '../lib/symbols.ts'

interface Props {
  symbol: string
  /** Screen position of the insertion point and pixels per drawing unit of the symbol (the block's own unit is 1). */
  x: number
  y: number
  scale: number
  /** The colour of the layer it sits on; symbols drawn "by block" take it. */
  color: string
}

const STROKE = 1.25

/** A bulged segment from a to b as an SVG arc, in screen coordinates (y already flipped, so a counter-clockwise bulge has sweep 0). */
function arc(ax: number, ay: number, bx: number, by: number, bulge: number): string {
  const d = Math.hypot(bx - ax, by - ay)
  const r = (d * (1 + bulge * bulge)) / (4 * Math.abs(bulge))
  return `A${r} ${r} 0 ${Math.abs(bulge) > 1 ? 1 : 0} ${bulge > 0 ? 0 : 1} ${bx} ${by}`
}

function path(p: Extract<Primitive, { t: 'P' }>, X: (x: number) => number, Y: (y: number) => number): string {
  let d = ''
  const n = p.v.length
  const last = p.closed ? n : n - 1
  p.v.forEach(([x, y], i) => {
    if (i === 0) d += `M${X(x)} ${Y(y)}`
    if (i >= last) return
    const [nx, ny] = p.v[(i + 1) % n]
    d += p.v[i][2] ? arc(X(x), Y(y), X(nx), Y(ny), p.v[i][2]) : `L${X(nx)} ${Y(ny)}`
  })
  return d + (p.closed ? 'Z' : '')
}

/** One legend symbol drawn as SVG at a point: the same geometry the DXF writes into its block. */
export function SymbolMark({ symbol, x, y, scale, color }: Props) {
  const prims = SYMBOLS[symbol]
  if (!prims) return null
  const X = (u: number) => u * scale
  const Y = (v: number) => -v * scale
  const colour = (k?: number) => (k === undefined || k === 0 ? color : aciToHex(k))
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth={STROKE} strokeLinejoin="round" aria-hidden="true">
      {prims.map((p, i) => {
        const c = colour(p.k)
        switch (p.t) {
          case 'L':
            return <line key={i} x1={X(p.a[0])} y1={Y(p.a[1])} x2={X(p.b[0])} y2={Y(p.b[1])} stroke={c} />
          case 'C':
            return <circle key={i} cx={X(p.c[0])} cy={Y(p.c[1])} r={p.r * scale} stroke={c} />
          case 'A': {
            const a0 = (p.s * Math.PI) / 180
            const a1 = (p.e * Math.PI) / 180
            const sweep = (((p.e - p.s) % 360) + 360) % 360
            return (
              <path
                key={i}
                d={`M${X(p.c[0] + p.r * Math.cos(a0))} ${Y(p.c[1] + p.r * Math.sin(a0))}A${p.r * scale} ${p.r * scale} 0 ${sweep > 180 ? 1 : 0} 0 ${X(p.c[0] + p.r * Math.cos(a1))} ${Y(p.c[1] + p.r * Math.sin(a1))}`}
                stroke={c}
              />
            )
          }
          case 'P':
            // a polyline with a width (the filled pin) is stroked that wide
            return <path key={i} d={path(p, X, Y)} stroke={c} strokeWidth={p.w ? Math.max(STROKE, p.w * scale) : STROKE} />
          case 'S':
            return <polygon key={i} points={[0, 1, 3, 2].filter((k) => p.p[k]).map((k) => `${X(p.p[k][0])},${Y(p.p[k][1])}`).join(' ')} fill={c} stroke="none" />
          case 'T':
            return (
              <text key={i} x={X(p.q?.[0] ?? p.p[0])} y={Y(p.q?.[1] ?? p.p[1])} fontSize={p.h * scale} textAnchor="middle" dominantBaseline="central" fill={c} stroke="none">
                {p.s}
              </text>
            )
        }
      })}
    </g>
  )
}
