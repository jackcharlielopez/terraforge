import type { Call } from './deedcalls.ts'

/** A call as a surveyor writes it: S 04°00'00" W 710.00', with a note when its bearing was filled in or could not be read. */
export function label(c: Call): string {
  const deg = c.deg === null ? '?' : String(c.deg).padStart(2, '0')
  const bearing = `${c.ns} ${deg}°${String(c.min).padStart(2, '0')}'${String(c.sec).padStart(2, '0')}" ${c.ew}`
  return `${bearing} ${c.distance.toFixed(2)}'${c.inferred ? ` (${c.inferred})` : ''}`
}
