import { Accordion } from '../Accordion.tsx'
import { formatSize } from '../../lib/files.ts'
import { label } from '../../lib/deedlabels.ts'
import type { Anchor } from '../../lib/deedfit.ts'
import type { useDeedReading, ReadTract } from '../../hooks/useDeedReading.ts'
import type { Deed } from '../../hooks/useDeed.ts'

type Reading = ReturnType<typeof useDeedReading>

interface Props {
  deeds: Deed[]
  onRemove: (id: string) => void
  onClear: () => void
  reading: Reading
  /** Pins and monuments found in the field: the outline is placed on these. */
  anchors: Anchor[]
  hasPoints: boolean
}

const VERDICT_TEXT = { ok: 'Closes and matches', check: 'Check this read', fail: 'Not trusted, nothing drawn' } as const

/** The best read among a deed's descriptions, for its badge: OK beats Check beats Not read. */
function bestVerdict(tracts: ReadTract[]): 'ok' | 'check' | 'fail' {
  if (tracts.some((t) => t.assessment.verdict === 'ok')) return 'ok'
  if (tracts.some((t) => t.assessment.verdict === 'check')) return 'check'
  return 'fail'
}

/** The attached deeds: each is read for its land description, the calls are shown with the checks on them, and one outline is placed on the pins. */
export function DeedPanel({ deeds, onRemove, onClear, reading, anchors, hasPoints }: Props) {
  const unread = deeds.filter((d) => ['idle', 'error'].includes(reading.stateOf(d.id).status)).length
  const busy = deeds.some((d) => reading.stateOf(d.id).status === 'reading')
  const { placed } = reading
  return (
    <Accordion title={deeds.length === 1 ? 'Deed' : 'Deeds'} defaultOpen badge={<span className="count">{deeds.length}</span>}>
      <p className="muted small">
        Each deed is read in this browser (its text, or OCR for a scan) and its calls are checked: they must close and match the stated acreage before anything is drawn. Nothing is uploaded; the first OCR run downloads its language data.
      </p>
      <div className="row tight">
        {deeds.length > 1 && (
          <button className="btn btn-outline btn-sm" disabled={busy || unread === 0} onClick={() => void reading.readAll()}>
            {unread === deeds.length ? 'Read all' : `Read the other ${unread}`}
          </button>
        )}
        <button className="btn btn-outline btn-sm" onClick={onClear}>
          {deeds.length > 1 ? 'Remove all' : 'Remove'}
        </button>
      </div>
      {placed?.result.ok && (
        <p className="boundary-total" role="status">
          Property line placed from {placed.deedName} ({placed.tract}): turned {placed.result.placement.rotation.toFixed(2)}° to meet the grid; {placed.result.placement.hits.length} found pins lie on its lines ({placed.result.placement.hits.map((h) => `${h.anchor}${h.corner !== null ? ' at a corner' : ' on a line'}, ${h.distance.toFixed(2)} ft`).join('; ')}).{' '}
          <button className="btn btn-outline btn-sm" onClick={reading.unplace}>
            Remove outline
          </button>
        </p>
      )}
      <ul className="deed-list">
        {deeds.map((deed) => (
          <DeedCard key={deed.id} deed={deed} reading={reading} anchors={anchors} hasPoints={hasPoints} onRemove={() => onRemove(deed.id)} />
        ))}
      </ul>
    </Accordion>
  )
}

function DeedCard({ deed, reading, anchors, hasPoints, onRemove }: { deed: Deed; reading: Reading; anchors: Anchor[]; hasPoints: boolean; onRemove: () => void }) {
  const s = reading.stateOf(deed.id)
  const tract = s.tracts[s.selected] ?? null
  const a = tract?.assessment
  const t = a?.traverse
  const placedHere = reading.placed?.deedId === deed.id ? reading.placed : null
  const agreements = s.status === 'done' ? reading.agreements(deed.id) : []
  const badge = s.status === 'done' && s.tracts.length > 0 ? bestVerdict(s.tracts) : null
  return (
    <li className="deed-card">
      <div className="deed-head">
        <span className="deed-name" title={deed.name}>
          {deed.name} <span className="muted">· {formatSize(deed.size)}</span>
        </span>
        {badge && <span className={'verdict ' + badge}>{badge === 'ok' ? 'OK' : badge === 'check' ? 'Check' : 'Not trusted'}</span>}
        {s.status === 'done' && s.tracts.length === 0 && <span className="verdict none">No calls</span>}
      </div>
      {deed.type.startsWith('image/') && <img className="deed-thumb" src={deed.url} alt={`Attached deed ${deed.name}`} />}

      {s.status === 'idle' && (
        <button className="btn btn-outline btn-sm" onClick={() => void reading.read(deed)}>
          Read the land description
        </button>
      )}
      {s.status === 'reading' && (
        <p className="muted small" role="status">
          {s.progress?.stage === 'recognising' ? `Reading page ${s.progress.page} of ${s.progress.pages} (OCR)…` : s.progress?.stage === 'text layer' ? `Looking at page ${s.progress.page} of ${s.progress.pages}…` : 'Opening the deed…'}
        </p>
      )}
      {s.status === 'error' && (
        <p className="lines-note warn" role="alert">
          {s.error}
        </p>
      )}

      {s.status === 'done' && (
        <>
          <p className="muted small">
            Read {s.info?.pages} {s.info?.pages === 1 ? 'page' : 'pages'} from the {s.info?.method}.{' '}
            {s.tracts.length === 0 ? 'No bearings and distances were found: this may be an easement, an affidavit, or a deed that refers to a plat or another deed.' : `${s.tracts.length} ${s.tracts.length === 1 ? 'description' : 'descriptions'} with calls.`}
          </p>
          {s.tracts.length > 1 && (
            <label className="small">
              Description{' '}
              <select value={s.selected} onChange={(e) => reading.select(deed.id, Number(e.target.value))} aria-label={`Which description in ${deed.name}`}>
                {s.tracts.map((x, i) => (
                  <option key={x.label} value={i}>
                    {x.label} ({x.calls.length} calls{x.assessment.verdict === 'fail' ? ', not trusted' : ''})
                  </option>
                ))}
              </select>
            </label>
          )}
          {tract && a && (
            <div className={'review-card verdict-card ' + a.verdict} role="status">
              <strong>{VERDICT_TEXT[a.verdict]}</strong>
              {t && (
                <span className="small">
                  {tract.calls.length} calls, {t.perimeter.toFixed(0)} ft around · {t.areaAcres.toFixed(2)} acres{tract.statedAcres !== null ? ` (the deed says ${tract.statedAcres})` : ''} · {Number.isFinite(t.ratio) ? `closes to 1 in ${Math.round(t.ratio).toLocaleString('en-US')}` : 'closes exactly'}
                </span>
              )}
              {a.reasons.map((r) => (
                <span key={r} className="small">
                  {r}
                </span>
              ))}
              <details>
                <summary className="small">The calls as read</summary>
                <ol className="calls small mono">
                  {tract.calls.map((c, i) => (
                    <li key={i} className={c.unsure || c.inferred ? 'flag' : undefined} title={c.text}>
                      {label(c)}
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          )}
          {agreements.map((g) => (
            <div key={g.otherId + g.otherTract} className={'review-card' + (g.comparison.differences.length > 0 ? ' verdict-card check' : '')} role="status">
              <span className="small">
                <b>Same land as {g.otherName}</b> ({g.otherTract}): {g.comparison.agree} of {g.comparison.total} calls agree.
                {g.comparison.differences.length === 0 ? ' Nothing differs.' : ' They differ, so one copy may have a mistake:'}
              </span>
              {g.comparison.differences.slice(0, 5).map((d, i) => (
                <span key={i} className="small mono">
                  here {d.here ?? '(no call)'} · there {d.there ?? '(no call)'}
                </span>
              ))}
            </div>
          ))}
          {tract && a && a.verdict !== 'fail' && (
            <>
              {placedHere && !placedHere.result.ok && (
                <p className="lines-note warn" role="alert">
                  {placedHere.result.message}
                </p>
              )}
              <div className="row tight">
                <button className="btn btn-outline btn-sm" disabled={!hasPoints} title={hasPoints ? 'Fit it to the iron pins and monuments found in the field' : 'Load the survey points first'} onClick={() => reading.place(deed, anchors)}>
                  {placedHere?.result.ok ? 'Place again' : 'Place on the drawing'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <div className="row tight">
        <a className="btn btn-outline btn-sm" href={deed.url} target="_blank" rel="noopener">
          Open
        </a>
        {s.status === 'done' && (
          <button className="btn btn-outline btn-sm" onClick={() => void reading.read(deed)}>
            Read again
          </button>
        )}
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            reading.forget(deed.id)
            onRemove()
          }}
        >
          Remove
        </button>
      </div>
    </li>
  )
}
