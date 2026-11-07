import { describe, expect, it } from 'vitest'
import { FEATURES } from './features.ts'
import { classifyFile, groupFiles } from './files.ts'

// Run with VITE_FEATURE_COMPARE=false to check the flag-off behaviour; the default build has compare on.
describe('feature flags: compare', () => {
  it('accepts a .dxf to compare when on, and turns it away with a note when off', () => {
    const out = groupFiles([new File(['x'], 'finished.dxf')])
    if (FEATURES.compare) {
      expect(classifyFile('finished.dxf')).toBe('reference')
      expect(out.picked.reference?.name).toBe('finished.dxf')
    } else {
      expect(classifyFile('finished.dxf')).toBe('unknown')
      expect(out.picked.reference).toBeUndefined()
      expect(out.notes[0]).toContain('finished.dxf')
    }
  })
})
