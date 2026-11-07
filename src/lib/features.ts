/**
 * Feature flags, set when the app is built (or started): `VITE_FEATURE_COMPARE=false npm run build`, or a line in `.env.local`.
 * Anything other than "false", "0" or "off" leaves a feature on, so the default build has everything.
 */
function flag(value: unknown): boolean {
  return !['false', '0', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase())
}

export const FEATURES = {
  /** Compare against a finished .dxf: the Compare DXF slot, the side-by-side overlay and the match panel. */
  compare: flag(import.meta.env.VITE_FEATURE_COMPARE),
}
