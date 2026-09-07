import { backfillTasks } from '../../src/server/follow-up/tasks'

/**
 * Creates the follow-up tasks a campaign now asks for, for everyone who
 * signed before it did. Dry run unless told otherwise; test registrations
 * are skipped either way.
 *
 *   npx dotenv -e <env> -- npx tsx scripts/ops/backfill-follow-up-tasks.ts <groupId> [--apply]
 */
async function main() {
  const [groupId] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!groupId) {
    console.error('usage: backfill-follow-up-tasks.ts <groupId> [--apply]')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const result = await backfillTasks(groupId, { apply })
  console.log(JSON.stringify({ groupId, mode: apply ? 'apply' : 'dry-run', ...result }))
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
