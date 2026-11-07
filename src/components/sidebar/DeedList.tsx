import { StatusIcon } from '../StatusIcon.tsx'
import type { Status } from '../StatusIcon.tsx'
import { label } from '../../lib/deedlabels.ts'
import type { useDeedReading, ReadTract } from '../../hooks/useDeedReading.ts'
import type { Deed } from '../../hooks/useDeed.ts'

type Reading = ReturnType<typeof useDeedReading>

interface Props {
  deeds: Deed[]
  reading: Reading
}

/** The best read among a deed's descriptions, for its badge: OK beats Check beats Not trusted. */
function bestVerdict(tracts: ReadTract[]): 'ok' | 'check' | 'fail' {
  if (tracts.some((t) => t.assessment.verdict === 'ok')) return 'ok'
  if (tracts.some((t) => t.assessment.verdict === 'check')) return 'check'
  return 'fail'
}

/**
 * The deeds under the Deed slot in the Files panel: just what was read out of each file (its calls). A status icon carries how the
 * read went; the outlines drawn from the deeds are switched on and off in the Layers panel. Deeds read themselves as they are added.
 */
export function DeedList({ deeds, reading }: Props) {
  const states = deeds.map((d) => reading.stateOf(d.id))
  const busy = states.filter((s) => s.status === 'reading' || s.status === 'idle').length
  return (
    <details className="deed-dropdown" open>
      <summary>
        <span className="deed-summary-label">{deeds.length === 1 ? '1 deed' : `${deeds.length} deeds`}</span>
        {busy > 0 && <span className="muted small"> · reading {busy}…</span>}
      </summary>
      <ul className="deed-list">
        {deeds.map((deed) => (
          <DeedItem key={deed.id} deed={deed} reading={reading} />
        ))}
      </ul>
    </details>
  )
}

function DeedItem({ deed, reading }: { deed: Deed; reading: Reading }) {
  const s = reading.stateOf(deed.id)
  const tract = s.tracts[s.selected] ?? null
  const badge = s.status === 'done' && s.tracts.length > 0 ? bestVerdict(s.tracts) : null
  const status =
    s.status === 'reading'
      ? s.progress?.stage === 'recognising'
        ? `page ${s.progress.page} of ${s.progress.pages}…`
        : 'reading…'
      : s.status === 'idle'
        ? 'waiting…'
        : null
  const rowStatus: Status = s.status === 'reading' || s.status === 'idle' ? 'loading' : s.status === 'error' ? 'error' : badge === 'ok' ? 'ok' : 'warning'
  const rowLabel =
    s.status === 'reading' ? 'Reading' : s.status === 'idle' ? 'Waiting to be read' : s.status === 'error' ? 'Could not be read' : badge === 'ok' ? 'Closes and matches' : badge === 'check' ? 'Check this read' : badge === 'fail' ? 'Does not close or match: drawn dashed as unverified' : 'No bearings and distances found'
  return (
    <li className="deed-card">
      <details>
        <summary className="deed-head">
          <span className="deed-title">
            <StatusIcon small status={rowStatus} label={rowLabel} />
            <span className="deed-name" title={deed.name}>
              {deed.name}
            </span>
          </span>
          {status && <span className="muted small">{status}</span>}
        </summary>

        {s.status === 'error' && (
          <p className="lines-note warn" role="alert">
            {s.error}
          </p>
        )}
        {s.status === 'done' && s.tracts.length === 0 && <p className="muted small">No bearings and distances found.</p>}
        {s.status === 'done' && s.tracts.length > 1 && (
          <label className="small">
            <select value={s.selected} onChange={(e) => reading.select(deed.id, Number(e.target.value))} aria-label={`Which description in ${deed.name}`}>
              {s.tracts.map((x, i) => (
                <option key={x.label} value={i}>
                  {x.label} ({x.calls.length} calls)
                </option>
              ))}
            </select>
          </label>
        )}
        {s.status === 'done' && tract && (
          <>
            <ol className="calls small mono">
              {tract.calls.map((c, i) => (
                <li key={i} className={c.unsure || c.inferred ? 'flag' : undefined} title={c.text}>
                  {label(c)}
                </li>
              ))}
            </ol>
            {tract.assessment.verdict === 'fail' &&
              tract.repairs.map((r) => (
                <div key={r.index + r.what + r.to} className="repair small">
                  <span>
                    Call {r.index + 1} may read {r.to}, not {r.from}.
                  </span>
                  <button className="btn btn-outline btn-sm" onClick={() => reading.useRepair(deed.id, s.selected, r)}>
                    Use this fix
                  </button>
                </div>
              ))}
          </>
        )}

      </details>
    </li>
  )
}
