import { Accordion } from '../Accordion.tsx'
import { Swatch } from '../Swatch.tsx'
import { REF_OVERLAY_COLOR } from '../Preview.tsx'
import type { RefMode } from '../Preview.tsx'
import { aciToHex } from '../../lib/aci.ts'
import type { CompareStats } from '../../lib/compare.ts'
import type { RefShapes } from '../../lib/dxfview.ts'
import { formatSize } from '../../lib/files.ts'

interface Props {
  name: string
  size: number
  shapes: RefShapes
  /** Whether survey points are loaded; without them the reference is shown on its own and nothing is compared. */
  hasData: boolean
  mode: RefMode
  onMode: (m: RefMode) => void
  stats: CompareStats | null
  hidden: ReadonlySet<string>
  onToggleLayer: (layer: string) => void
  /** Panel filter: which reference layers to list. */
  hit: (...fields: string[]) => boolean
  onRemove: () => void
}

const MODES: { mode: RefMode; label: string }[] = [
  { mode: 'generated', label: 'Ours' },
  { mode: 'reference', label: 'Reference' },
  { mode: 'both', label: 'Both' },
]

/** Overlay a finished DXF on our output and report how closely the two agree. */
export function ComparePanel({ name, size, shapes, hasData, mode, onMode, stats, hidden, onToggleLayer, hit, onRemove }: Props) {
  const layers = shapes.layers.filter((l) => hit(l.name))
  return (
    <Accordion title="Compare" badge={<span className="count">{shapes.layers.length} layers</span>}>
      <p className="deed-name" title={name}>
        {name} <span className="muted">· {formatSize(size)}</span>
      </p>
      {hasData ? (
        <div className="seg" role="radiogroup" aria-label="What to show">
          {MODES.map((m) => (
            <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} className={mode === m.mode ? 'on' : ''} onClick={() => onMode(m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">Showing the drawing on its own. Add a points file to overlay it and compare.</p>
      )}
      {mode === 'both' && hasData && (
        <p className="muted small">
          <Swatch color={REF_OVERLAY_COLOR} /> dashed blue = reference, solid = ours.
        </p>
      )}
      {stats && <ComparisonStats stats={stats} />}
      <p className="muted small">Only point positions and lines between two survey points are compared. Building outlines, property lines and other geometry are not.</p>
      <ul className="layers">
        {layers.map((l) => (
          <li key={l.name}>
            <label>
              <input type="checkbox" checked={!hidden.has(l.name)} onChange={() => onToggleLayer(l.name)} />
              <Swatch color={aciToHex(l.aci)} />
              <span className="mono">{l.name}</span>
              <span className="muted">{l.count}</span>
            </label>
          </li>
        ))}
        {layers.length === 0 && <li className="muted small">No layers match.</li>}
      </ul>
      <p className="muted small">{referenceNotes(shapes)}</p>
      <div className="row">
        <button className="btn btn-outline btn-sm" onClick={onRemove}>
          Remove
        </button>
      </div>
    </Accordion>
  )
}

function ComparisonStats({ stats }: { stats: CompareStats }) {
  return (
    <ul className="stats" aria-label="Comparison">
      <li>
        <b>Points:</b> {stats.genPoints} ours · {stats.refPoints} in the reference · <b>{stats.matchedPoints}</b> at the same position
      </li>
      <li>
        <b>Lines between survey points:</b> the reference has {stats.refSegments}, we drew {stats.genSegments}, <b>{stats.matchedSegments}</b> are the same two points
      </li>
      {stats.genCrossings !== null && stats.refCrossings !== null && (
        <li>
          <b>Crossing lines:</b> {stats.genCrossings} in ours, {stats.refCrossings} in the reference
        </li>
      )}
      <li>
        We reproduce <b>{pct(stats.matchedSegments, stats.refSegments)}</b> of the reference&apos;s point-to-point lines; <b>{pct(stats.matchedSegments, stats.genSegments)}</b> of ours are in the reference.
      </li>
    </ul>
  )
}

function pct(a: number, b: number): string {
  return b === 0 ? 'n/a' : `${Math.round((100 * a) / b)}%`
}

/** What the picture leaves out, in plain words. */
function referenceNotes(r: RefShapes): string {
  const bits: string[] = []
  if (r.paperSpaceIgnored > 0) bits.push(`${r.paperSpaceIgnored} paper-space items (title block, viewports) are not shown`)
  if (r.atOrigin > 0) bits.push(`${r.atOrigin} stray points at 0,0 are left out of the view`)
  const nd = Object.entries(r.notDrawn)
  if (nd.length > 0) bits.push(`not drawn: ${nd.map(([t, n]) => `${n} ${t}`).join(', ')}`)
  bits.push('leaders, images, tables and hatches are not drawn, and curved polyline segments appear straight')
  return bits.join('; ') + '.'
}
