import { useId, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  title: string
  /** Small count/status chip next to the title. */
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export function Accordion({ title, badge, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className={'acc' + (open ? ' open' : '')}>
      <h2>
        <button type="button" className="acc-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden="true">▸</span>
          <span className="acc-title">{title}</span>
          {badge}
        </button>
      </h2>
      <div id={id} className="acc-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
