import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // One PGlite instance serves every file. Running files in parallel would
    // mean one database per worker and migrations run per worker, for no gain
    // on a suite this size.
    fileParallelism: false,
    // The suites that talk to a real Neon database or a real Blob store are
    // opt-in: they need credentials and run before a deploy, not on every
    // local `npm test`.
    exclude: ['**/node_modules/**', '**/*.neon.test.ts', '**/*.smoke.test.ts'],
  },
  resolve: { alias: { '@': resolve(__dirname, './src') } },
})
