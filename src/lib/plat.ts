/**
 * Plats are the AI reader's job (the paid tier): OCR found 6 of 19 distances and no bearings on the plats it was tried on, because the
 * numbers sit along the lines at angles, in tables, not in sentences. The free reader should say "this is a plat" instead of showing a
 * partial guess. Two signals, both checked against real deeds and plats (no deed in the test set matched):
 *  - the text has no "thence" (a deed's calls are sentences) but does have line / curve / area table markers (L1, C2, "line table") or
 *    several bearing strings: a drawing's labels, not a description;
 *  - the file is named like a plat (Plat Book, PB, Phase 2, Subdivision). A name can be wrong, so a plat-named file that OCR still read
 *    into a trusted description is kept (see `holdForAi`).
 */
const NAME = /\bplat\b|\bpb\b|\bph(?:ase)?\.?\s*\d|\bsub(?:division)?\b/i

export function looksLikePlat(name: string, text: string): boolean {
  if (NAME.test(name.replace(/[_.-]+/g, ' '))) return true
  const t = text.replace(/\s+/g, ' ')
  if (/\bthence\b/i.test(t)) return false
  const tables = (t.match(/\b(?:line|curve|chord|area|lot)\s+(?:table|schedule|data)\b/gi) ?? []).length
  const labels = (t.match(/\b[LC]\s?\d{1,2}\b/g) ?? []).length
  const bearings = (t.match(/\b[NS]\s?\d{1,2}\D{1,3}\d{1,2}\D{1,3}\d{0,2}\D{0,2}\s?[EW]\b/g) ?? []).length
  return tables >= 1 || labels >= 1 || bearings >= 3
}

/** A plat the free reader should not draw from: it looks like a plat and OCR did not produce a trusted description from it. */
export function holdForAi(name: string, text: string, verdicts: Array<'ok' | 'check' | 'fail'>): boolean {
  return looksLikePlat(name, text) && !verdicts.includes('ok')
}

export function platMessage(aiAvailable: boolean): string {
  return aiAvailable
    ? 'This looks like a plat. Plats are read by the AI reader: press Process with AI.'
    : 'This looks like a plat. Reading plats is part of the paid AI reader.'
}
