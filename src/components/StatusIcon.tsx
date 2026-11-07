/** `ready`: chosen but not read yet (the start screen, before "Start survey"). */
export type Status = 'loading' | 'ready' | 'ok' | 'warning' | 'error'

const GLYPH: Record<Exclude<Status, 'loading'>, string> = { ready: '✓', ok: '✓', warning: '!', error: '✕' }
const DEFAULT_LABEL: Record<Status, string> = { loading: 'Reading', ready: 'Ready to read', ok: 'Done', warning: 'Needs a look', error: 'Failed' }

/** A spinner while something is loading, then a check, a warning mark or an error mark. */
export function StatusIcon({ status, label, small = false }: { status: Status; label?: string; small?: boolean }) {
  const text = label ?? DEFAULT_LABEL[status]
  return (
    <span className={'status-icon ' + status + (small ? ' small' : '')} role={status === 'loading' ? 'status' : 'img'} aria-label={text} title={text}>
      {status === 'loading' ? '' : GLYPH[status]}
    </span>
  )
}
