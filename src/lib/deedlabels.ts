import type { Call } from './deedcalls.ts'

/** A call as a surveyor writes it: S 04°00'00" W 710.00', with a note when its bearing was filled in or could not be read. */
export function label(c: Call): string {
  const deg = c.deg === null ? '?' : String(c.deg).padStart(2, '0')
  const bearing = `${c.ns} ${deg}°${String(c.min).padStart(2, '0')}'${String(c.sec).padStart(2, '0')}" ${c.ew}`
  const curve = c.curve ? ` chord, curve ${c.curve.direction === 'L' ? 'left' : 'right'} R=${c.curve.radius.toFixed(2)}'${c.curve.arcLength !== undefined ? ` arc ${c.curve.arcLength.toFixed(2)}'` : ''}` : ''
  return `${bearing} ${c.distance.toFixed(2)}'${curve}${c.inferred ? ` (${c.inferred})` : ''}`
}
