import { useState } from 'react'
import { Accordion } from '../Accordion.tsx'
import type { ReviewTool } from '../../hooks/useReview.ts'
import type { Segment } from '../../lib/review.ts'
import type { SurveyPoint } from '../../lib/types.ts'

interface Props {
  points: SurveyPoint[]
  /** Layer names a drafter can draw a new line on. */
  layers: string[]
  tool: ReviewTool
  onTool: (t: ReviewTool) => void
  /** The picked segment, with where it came from. */
  selected: { seg: Segment; source: 'rule' | 'guess' | 'manual' } | null
  counts: { guesses: number; accepted: number; rejected: number; added: number }
  addFrom: number | null
  /** Layer picked for new lines: '' means work it out from the two points' codes. */
  addLayer: string
  onAddLayer: (l: string) => void
  canUndo: boolean
  onAccept: () => void
  onReject: () => void
  onUndo: () => void
  onClear: () => void
  onExport: () => void
  eventCount: number
}

const SOURCE_TEXT = {
  rule: 'drawn from the codes and shot order',
  guess: 'a guess: made by joining line ends that continue each other, capping, or reordering a zig-zag',
  manual: 'a line you drew',
} as const

/** Review mode: look over the generated drawing, keep or remove segments, draw in what is missing. */
export function ReviewPanel(p: Props) {
  const [confirmClear, setConfirmClear] = useState(false)
  const pt = (i: number) => p.points[i]?.no ?? '?'
  return (
    <Accordion title="Review" defaultOpen badge={p.counts.guesses > 0 ? <span className="count">{p.counts.guesses} to check</span> : undefined}>
      <p className="muted small">
        Dashed amber lines are guesses. Click a line to keep or remove it, or use <b>Add a line</b> and click two points. Your changes go into the DXF and are kept in a log on this computer only. Nothing is sent anywhere.
      </p>

      <div className="seg-toggle" role="group" aria-label="Review tool">
        <button type="button" className={p.tool === 'select' ? 'on' : ''} aria-pressed={p.tool === 'select'} onClick={() => p.onTool('select')}>
          Check lines
        </button>
        <button type="button" className={p.tool === 'add' ? 'on' : ''} aria-pressed={p.tool === 'add'} onClick={() => p.onTool('add')}>
          Add a line
        </button>
      </div>

      {p.tool === 'select' ? (
        p.selected ? (
          <div className="review-card" role="status">
            <div>
              <b className="mono">
                {pt(p.selected.seg.a)} → {pt(p.selected.seg.b)}
              </b>{' '}
              · {p.selected.seg.layer}
            </div>
            <div className="muted small">{SOURCE_TEXT[p.selected.source]}</div>
            <div className="row tight">
              <button className="btn btn-outline btn-sm" onClick={p.onAccept}>
                Keep
              </button>
              <button className="btn btn-outline btn-sm" onClick={p.onReject}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <p className="muted small">Click a line in the drawing.</p>
        )
      ) : (
        <div className="review-card" role="status">
          <div className="muted small">
            {p.addFrom === null ? 'Click the first point.' : `From point ${pt(p.addFrom)}: click the second point.`}
          </div>
          <label className="small">
            Layer{' '}
            <select value={p.addLayer} onChange={(e) => p.onAddLayer(e.target.value)} aria-label="Layer for new lines">
              <option value="">Automatic (from the points&apos; codes)</option>
              {p.layers.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p className="small review-counts">
        {p.counts.accepted} kept · {p.counts.rejected} removed · {p.counts.added} added
      </p>
      <div className="row tight">
        <button className="btn btn-outline btn-sm" disabled={!p.canUndo} onClick={p.onUndo}>
          Undo
        </button>
        <button className="btn btn-outline btn-sm" disabled={p.eventCount === 0} onClick={p.onExport} title="Save the log as a file: points, codes, what was drawn and what you changed. Positions are relative to the job's centre; no file or client name.">
          Export log
        </button>
        {confirmClear ? (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              p.onClear()
              setConfirmClear(false)
            }}
          >
            Really clear
          </button>
        ) : (
          <button className="btn btn-outline btn-sm" disabled={p.eventCount === 0} onClick={() => setConfirmClear(true)}>
            Clear review
          </button>
        )}
      </div>
    </Accordion>
  )
}
