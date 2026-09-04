import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/manual/**/*.test.ts'],
    setupFiles: ['tests/setup/load-env.ts'],
    reporters: ['verbose'],
    testTimeout: 180000,
    retry: 0,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
