import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Production/credential probes are opt-in via vitest.manual.config.ts.
    // `npm test` must never call live providers or mutate production data.
    exclude: ['tests/manual/**'],
    setupFiles: ['tests/setup/load-env.ts'],
    reporters: ['verbose'],
    testTimeout: 30000,
    // Allow one retry for real-DB invariant tests — fixture-creating suites race
    // by design, and the structural fixture-name regex on the invariant tests
    // already filters out transient orgs. One retry covers transient inserts
    // that have not yet propagated when the invariant query runs.
    retry: 1,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` is a no-op in RSC bundlers but is unresolvable in the
      // node test runner; stub it so server modules can be imported in tests.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
