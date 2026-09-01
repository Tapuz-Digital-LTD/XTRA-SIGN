import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * The suites that need a real service — Neon and Vercel Blob.
 *
 * Deliberately does NOT load the PGlite/fake-storage setup: mocking the very
 * things under test would defeat the purpose. Run before a deploy.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.neon.test.ts', '**/*.smoke.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
  resolve: { alias: { '@': resolve(__dirname, './src') } },
})
