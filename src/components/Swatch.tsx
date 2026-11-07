import type { CSSProperties } from 'react'

/**
 * A small colour chip. The colour comes from data (a layer's colour), so it cannot be a fixed class; it is passed as the
 * `--swatch` custom property and painted by the `.swatch` rule in index.css. This is the only place a colour is set inline.
 */
export function Swatch({ color }: { color: string }) {
  return <i className="swatch" style={{ '--swatch': color } as CSSProperties} />
}
