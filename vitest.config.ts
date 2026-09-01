import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { config } from 'dotenv'

// Integration tests talk to the real docker-compose services, so they need the
// same env the app uses.
config({ path: '.env.local', quiet: true })

export default defineConfig({
  test: { environment: 'node' },
  resolve: { alias: { '@': resolve(__dirname, './src') } },
})
