/**
 * Feature flags, set when the app is built (or started): `VITE_FEATURE_COMPARE=false npm run build`, or a line in `.env.local`.
 * Anything other than "false", "0" or "off" leaves a feature on, so the default build has everything.
 */
function flag(value: unknown): boolean {
  return !['false', '0', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase())
}

/** Opt-in flag: off unless explicitly turned on, because it sends deed images to a model provider. */
function optIn(value: unknown): boolean {
  return ['true', '1', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase())
}

export const FEATURES = {
  /** Read deeds and plats with a vision model through the local backend (`npm run server`). Off by default and in the deployed build. */
  aiRead: optIn(import.meta.env.VITE_FEATURE_AI_READ),
  /** Compare against a finished .dxf: the Compare DXF slot, the side-by-side overlay and the match panel. */
  compare: flag(import.meta.env.VITE_FEATURE_COMPARE),
}
