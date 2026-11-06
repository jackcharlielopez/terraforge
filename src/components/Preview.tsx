import { useEffect, useMemo, useRef, useState } from 'react'
import { aciToHex } from '../lib/aci.ts'
import type { Annotation } from '../lib/boundary.ts'
import type { RefShapes } from '../lib/dxfview.ts'
import type { CodeDef, PointMatch, Polyline, SurveyPoint } from '../lib/types.ts'
import type { EdgeKey, Segment } from '../lib/review.ts'

export type RefMode = 'generated' | 'reference' | 'both'

/** Colour used for the reference drawing when it is overlaid on the generated one. */
export const REF_OVERLAY_COLOR = '#2563eb'

interface View {
  /** Screen pixels per drawing unit. */
  scale: number
  ox: number
  oy: number
}

interface Props {
  points: SurveyPoint[]
  matches: PointMatch[]
  lines: Polyline[]
  defs: Map<string, CodeDef>
  hiddenLayers: ReadonlySet<string>
  /** CSS colour per layer name. */
  layerHex: ReadonlyMap<string, string>
  /** A finished drawing loaded for comparison, and how to show it. */
  reference?: RefShapes | null
  refMode?: RefMode
  refHidden?: ReadonlySet<string>
  /** Text drawn along lines (bearings and distances). */
  labels?: readonly Annotation[]
  /** Review mode: segments can be picked and points clicked, and guessed segments are marked. */
  review?: ReviewView | null
}

export interface ReviewView {
  segments: readonly Segment[]
  /** Segments made by the guessing steps. */
  guessed: ReadonlySet<EdgeKey>
  /** Segments the drafter has looked at and kept. */
  accepted: ReadonlySet<EdgeKey>
  /** Segments the drafter drew in. */
  added: ReadonlySet<EdgeKey>
  selected: EdgeKey | null
  tool: 'select' | 'add'
  /** In the add tool: the first point clicked, waiting for the second. */
  addFrom: number | null
  onSegment: (seg: Segment) => void
  onPoint: (index: number) => void
}

export function Preview({ points, matches, lines, defs, hiddenLayers, layerHex, reference = null, refMode = 'both', refHidden, labels = [], review = null }: Props) {
  const colorOf = (layer: string) => layerHex.get(layer) ?? aciToHex(7)
  const refAci = useMemo(() => new Map((reference?.layers ?? []).map((l) => [l.name, l.aci])), [reference])
  const refColor = (layer: string) => (refMode === 'both' ? REF_OVERLAY_COLOR : aciToHex(refAci.get(layer) ?? 7))
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  // null = auto-fit; set once the user pans or zooms. The parent remounts us per file.
  const [userView, setUserView] = useState<View | null>(null)
  // A press only becomes a pan once the pointer has moved a little, so a plain click still reaches the line or point under it.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  // "Fit" frames the survey itself (our points, or the reference's POINT entities), so a legend or
  // title block placed far away in model space does not shrink it to a speck. "Show all" frames everything.
  const [fitAll, setFitAll] = useState(false)
  const extent = useMemo(() => {
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
    const add = (e: number, n: number) => {
      minE = Math.min(minE, e); maxE = Math.max(maxE, e)
      minN = Math.min(minN, n); maxN = Math.max(maxN, n)
    }
    for (const p of points) add(p.e, p.n)
    const r = reference?.extent
    if (reference && (fitAll || points.length === 0)) {
      const survey = reference.points.filter((p) => !(p.x === 0 && p.y === 0))
      if (fitAll || survey.length < 2) {
        if (r) { add(r.minX, r.minY); add(r.maxX, r.maxY) }
      } else {
        for (const p of survey) add(p.x, p.y)
      }
    }
    return minE === Infinity ? null : { minE, maxE, minN, maxN }
  }, [points, reference, fitAll])

  const fit = useMemo((): View | null => {
    if (!extent) return null
    const pad = 48
    const w = Math.max(extent.maxE - extent.minE, 1)
    const h = Math.max(extent.maxN - extent.minN, 1)
    const scale = Math.max(Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h), 0.001)
    return {
      scale,
      ox: (size.w - w * scale) / 2 - extent.minE * scale,
      oy: (size.h - h * scale) / 2 + extent.maxN * scale,
    }
  }, [extent, size])
  const view = userView ?? fit

  // Handlers read the latest auto-fit through a ref so they can start from it.
  const fitRef = useRef(fit)
  useEffect(() => {
    fitRef.current = fit
  }, [fit])

  // The container div is always the same element, so these listeners stay attached.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = ev.clientX - r.left
      const cy = ev.clientY - r.top
      const k = Math.exp(-ev.deltaY * 0.0015)
      setUserView((u) => {
        const v = u ?? fitRef.current
        if (!v) return u
        const scale = Math.min(Math.max(v.scale * k, 0.001), 5000)
        const f = scale / v.scale
        return { scale, ox: cx - (cx - v.ox) * f, oy: cy - (cy - v.oy) * f }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  if (!view || !extent) {
    return (
      <div className="preview empty" ref={box} />
    )
  }

  const sx = (e: number) => e * view.scale + view.ox
  const sy = (n: number) => -n * view.scale + view.oy
  const px = view.scale // one drawing unit in pixels; text height is 1 unit
  const showNo = px >= 7
  const showMore = px >= 12
  const show = (layer: string) => !hiddenLayers.has(layer)

  // Pick the colour of a point's first visible feature layer, else a neutral dot.
  const dotColor = (m: PointMatch): string => {
    for (const code of m.codes) {
      const layer = defs.get(code)?.layer
      if (layer && show(layer)) return colorOf(layer)
    }
    return m.unknown.length > 0 ? colorOf('V-NODE') : colorOf('PNTS')
  }

  return (
    <div className="preview" ref={box}>
      <svg
        width={size.w}
        height={size.h}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          if (!d.moved) {
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
            d.moved = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          drag.current = { x: e.clientX, y: e.clientY, moved: true }
          setUserView((u) => {
            const v = u ?? fitRef.current
            return v ? { ...v, ox: v.ox + dx, oy: v.oy + dy } : u
          })
        }}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label="Plan view of the survey drawing"
      >
        {reference && refMode !== 'generated' && (
          <g className="reference" opacity={refMode === 'both' ? 0.9 : 1}>
            {reference.lines
              .filter((l) => !refHidden?.has(l.layer))
              .map((l, i) => (
                <polyline
                  key={i}
                  points={l.pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ') + (l.closed ? ` ${sx(l.pts[0][0])},${sy(l.pts[0][1])}` : '')}
                  fill="none"
                  stroke={refColor(l.layer)}
                  strokeWidth={1.5}
                  strokeDasharray={refMode === 'both' ? '6 3' : undefined}
                  strokeLinejoin="round"
                />
              ))}
            {reference.circles
              .filter((c) => !refHidden?.has(c.layer))
              .map((c, i) => (
                <circle key={'c' + i} cx={sx(c.x)} cy={sy(c.y)} r={Math.max(2, c.r * px)} fill="none" stroke={refColor(c.layer)} strokeWidth={1.25} />
              ))}
            {reference.points
              .filter((p) => !refHidden?.has(p.layer) && !(p.x === 0 && p.y === 0))
              .map((p, i) => (
                <circle key={'p' + i} cx={sx(p.x)} cy={sy(p.y)} r={1.6} fill={refColor(p.layer)} />
              ))}
            {reference.texts
              .filter((t) => !refHidden?.has(t.layer) && t.h * px >= 5)
              .map((t, i) => (
                <text key={'t' + i} x={sx(t.x)} y={sy(t.y)} fontSize={Math.min(t.h * px, 14)} fill={refColor(t.layer)} textAnchor="middle">
                  {t.text}
                </text>
              ))}
          </g>
        )}
        {refMode !== 'reference' && (
          <>
        {lines
          .filter((l) => show(l.layer))
          .map((l, i) => (
            <polyline
              key={i}
              points={l.vertices.map((v) => `${sx(v.e)},${sy(v.n)}`).join(' ') + (l.closed ? ` ${sx(l.vertices[0].e)},${sy(l.vertices[0].n)}` : '')}
              fill="none"
              stroke={colorOf(l.layer)}
              strokeWidth={1.75}
              strokeLinejoin="round"
            />
          ))}
        {review && (
          <g className="review-layer">
            {review.segments
              .filter((s) => show(s.layer))
              .map((s) => {
                const a = points[s.a]
                const b = points[s.b]
                const x1 = sx(a.e), y1 = sy(a.n), x2 = sx(b.e), y2 = sy(b.n)
                const guess = review.guessed.has(s.key) && !review.accepted.has(s.key)
                const mine = review.added.has(s.key)
                const sel = review.selected === s.key
                return (
                  <g key={s.key + s.layer}>
                    {(guess || mine || sel || review.accepted.has(s.key)) && (
                      <line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={sel ? 'var(--green)' : mine ? '#7c3aed' : guess ? 'var(--amber)' : '#16a34a'}
                        strokeWidth={sel ? 6 : guess ? 4 : 3}
                        strokeOpacity={sel ? 0.35 : 0.8}
                        strokeDasharray={guess ? '6 4' : undefined}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                    )}
                    {review.tool === 'select' && (
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} onClick={() => review.onSegment(s)} />
                    )}
                  </g>
                )
              })}
          </g>
        )}
        {show('PNTS') &&
          points.map((p, i) => (
            <circle
              key={p.no + ':' + i}
              cx={sx(p.e)}
              cy={sy(p.n)}
              r={Math.max(2.5, 0.5 * px)}
              fill={review?.addFrom === i ? 'var(--amber)' : 'var(--paper)'}
              stroke={dotColor(matches[i])}
              strokeWidth={review?.addFrom === i ? 3 : 1.5}
              style={review?.tool === 'add' ? { cursor: 'crosshair' } : undefined}
              onClick={review?.tool === 'add' ? () => review.onPoint(i) : undefined}
            />
          ))}
        {showNo &&
          points.map((p, i) => (
            <g key={'t' + i} fontSize={Math.min(px, 14)} fill="var(--text)">
              {show('PNTNO') && (
                <text x={sx(p.e)} y={sy(p.n + 0.75)} textAnchor="middle" fill={colorOf('PNTNO')} fontWeight={600}>
                  {p.no}
                </text>
              )}
              {showMore && show('PNTELEV') && (
                <text x={sx(p.e + 1.5)} y={sy(p.n - 0.5)} fill={colorOf('PNTELEV')}>
                  {p.z.toFixed(2)}
                </text>
              )}
              {showMore && show('PNTDESC') && p.desc && (
                <text x={sx(p.e)} y={sy(p.n - 1.75)} textAnchor="middle" fill={colorOf('PNTDESC')}>
                  {p.desc}
                </text>
              )}
            </g>
          ))}
          {labels
            .filter((a) => show(a.layer))
            .map((a, i) => (
              <text
                key={'lbl' + i}
                x={sx(a.x)}
                y={sy(a.y)}
                fontSize={Math.max(9, Math.min(a.height * px, 14))}
                textAnchor="middle"
                fill={colorOf(a.layer)}
                transform={`rotate(${-a.rotation} ${sx(a.x)} ${sy(a.y)})`}
              >
                {a.text}
              </text>
            ))}
          </>
        )}
      </svg>
      <div className="preview-tools">
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            setFitAll(false)
            setUserView(null)
          }}
        >
          Fit
        </button>
        {reference && (
          <button
            className="btn btn-outline btn-sm"
            title="Frame everything in the drawing, including a legend or title block placed far from the survey"
            onClick={() => {
              setFitAll(true)
              setUserView(null)
            }}
          >
            Show all
          </button>
        )}
        <span className="muted">Drag to pan, scroll to zoom. Labels appear as you zoom in.</span>
      </div>
    </div>
  )
}
