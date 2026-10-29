import { describe, expect, it, vi } from 'vitest'

// Every query would wake the database; these addresses must not cost one.
vi.mock('@/server/db', () => ({
  getDb: () => {
    throw new Error('the database was asked')
  },
  schema: {},
}))

const { resolvePublicSlug } = await import('../public-slug')

describe('resolvePublicSlug', () => {
  it('answers what can never be a public address without asking the database', async () => {
    for (const path of ['favicon.ico', 'robots.txt', 'apple-touch-icon-precomposed.png', 'wp-login.php', 'Tourism-2026', 'תיירות', 'a_b']) {
      expect(await resolvePublicSlug(path)).toBeNull()
    }
  })
})
