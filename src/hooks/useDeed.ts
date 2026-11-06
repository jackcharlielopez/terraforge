import { useEffect, useRef, useState } from 'react'

export interface Deed {
  id: string
  name: string
  size: number
  type: string
  url: string
}

/** The attached deeds live only in memory for this tab; their blob URLs are released when removed, cleared or on unmount. */
export function useDeeds() {
  const [deeds, setDeeds] = useState<Deed[]>([])
  const current = useRef<Deed[]>([])
  const urls = useRef(new Map<string, string>())
  useEffect(() => {
    const held = urls.current
    return () => {
      for (const u of held.values()) URL.revokeObjectURL(u)
    }
  }, [])

  const commit = (next: Deed[]) => {
    current.current = next
    setDeeds(next)
  }

  /** Add deeds; one already attached (same name and size) is not added twice. Returns how many were new. */
  const add = (files: File[]): number => {
    const fresh = files
      .filter((f) => !current.current.some((d) => d.name === f.name && d.size === f.size))
      .map((f): Deed => {
        const id = crypto.randomUUID()
        const url = URL.createObjectURL(f)
        urls.current.set(id, url)
        return { id, name: f.name, size: f.size, type: f.type, url }
      })
    if (fresh.length > 0) commit([...current.current, ...fresh])
    return fresh.length
  }
  const remove = (id: string) => {
    const url = urls.current.get(id)
    if (url) URL.revokeObjectURL(url)
    urls.current.delete(id)
    commit(current.current.filter((d) => d.id !== id))
  }
  const clear = () => {
    for (const u of urls.current.values()) URL.revokeObjectURL(u)
    urls.current.clear()
    commit([])
  }
  return { deeds, add, remove, clear }
}
