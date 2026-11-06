/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'

// A few suites check the generator against one real survey job (points file + finished DXF). That job is client data and
// is not in the public repo, so those suites only run when the files are present locally (see samples/README.md).
const HAS_JOB_DATA = existsSync('samples/job-a.txt') && existsSync('reference/job-a.dxf')
const NEEDS_JOB_DATA = ['parse', 'dxf', 'boundary', 'dxfview', 'linework.reference', 'rules'].map((n) => `src/lib/${n}.test.ts`)

// base must match the GitHub repo name for GitHub Pages project sites.
export default defineConfig({
  base: '/terraforge/',
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'], exclude: HAS_JOB_DATA ? [] : NEEDS_JOB_DATA },
})
