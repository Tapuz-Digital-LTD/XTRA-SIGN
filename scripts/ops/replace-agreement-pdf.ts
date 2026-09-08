import { readFileSync } from 'node:fs'
import { and, eq, isNull } from 'drizzle-orm'
import type { StaffSession } from '../../src/server/auth/session'
import { extractPdfText } from '../../src/server/crm/__tests__/pdf-text'
import { getDb, schema } from '../../src/server/db'
import { getSelfServiceConfig } from '../../src/server/projects/self-service'
import { getStorage } from '../../src/server/storage/blob'
import { replaceTemplate } from '../../src/server/templates/replace'
import { createTemplateFromPdf } from '../../src/server/templates/templates'

/**
 * A new edition of a campaign's agreement, from a new PDF.
 *
 * The signed file is never the PDF on disk: a template holds its own copy in
 * storage, and every registration copies that into its own frozen version. So
 * changing the document means making a new edition and pointing the campaign
 * at it — exactly what the templates screen's replace wizard does, through the
 * same two functions, with the same audit row.
 *
 * Documents already made keep the copy they were made with: nothing signed and
 * nothing already sent changes. Only registrations from now on carry the new
 * text.
 *
 *   PROJECT_NAME='…' PDF=.design/tourism-2026/agreement-digital.pdf \
 *   EXPECT='a phrase that must be in the new file' \
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/ops/replace-agreement-pdf.ts
 *
 * Add APPLY=1 to write; without it the script says what it would do.
 */

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'חודש התיירות הישראלית 2026'
const PDF = process.env.PDF ?? '.design/tourism-2026/agreement-digital.pdf'
/** A phrase that proves the right file was handed over. */
const EXPECT = process.env.EXPECT ?? 'מסובסדת על ידי משרד התיירות'
const APPLY = process.env.APPLY === '1'

async function main() {
  const bytes = readFileSync(PDF)
  const text = await extractPdfText(bytes)
  if (!text.includes(EXPECT)) throw new Error(`${PDF} does not contain "${EXPECT}" — wrong file?`)

  const db = getDb()
  const [org] = await db.select().from(schema.organizations).limit(1)
  if (!org) throw new Error('no organization')
  const [owner] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.organizationId, org.id), eq(schema.users.isAdmin, true), isNull(schema.users.disabledAt)))
    .limit(1)
  if (!owner) throw new Error('no admin')
  const session: StaffSession = { userId: owner.id, organizationId: org.id, email: owner.email, name: owner.name, isAdmin: true }

  const [group] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.organizationId, org.id), eq(schema.groups.name, PROJECT_NAME), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!group) throw new Error(`no campaign named ${PROJECT_NAME}`)

  const config = await getSelfServiceConfig(session, group.id)
  const currentId = config?.templateId ?? group.defaultTemplateId
  if (!currentId) throw new Error('the campaign has no agreement template to replace')
  const [current] = await db.select().from(schema.templates).where(eq(schema.templates.id, currentId)).limit(1)
  if (!current) throw new Error(`template ${currentId} not found`)

  const currentText = current.sourceFileKey ? await extractPdfText(await getStorage().get(current.sourceFileKey)) : ''
  if (currentText.includes(EXPECT)) {
    console.log(`the campaign's agreement already carries "${EXPECT}" — nothing to do`)
    return
  }

  console.log(`campaign : ${group.name}`)
  console.log(`current  : ${current.id} — ${current.name}`)
  console.log(`new file : ${PDF} (${bytes.length} bytes)`)
  if (!APPLY) {
    console.log('\ndry run — add APPLY=1 to create the new edition and point the campaign at it')
    return
  }

  // The same name: the edition is a new row, not a new document, and the name
  // travels into the title of every agreement made from it.
  const created = await createTemplateFromPdf({ session, buffer: bytes, name: current.name })
  if (!created.ok) throw new Error(created.message)
  console.log(`created  : ${created.templateId} (${created.fieldCount} fields)`)
  if (created.fieldCount !== (current.fields as unknown[] | null)?.length) {
    console.warn(`⚠ field count changed: ${(current.fields as unknown[] | null)?.length} → ${created.fieldCount}`)
  }

  const replaced = await replaceTemplate(session, current.id, created.templateId)
  if (!replaced.ok) throw new Error(replaced.message)
  console.log(`replaced : ${replaced.rebound} campaign reference(s) now point at the new edition`)

  const [fresh] = await db.select().from(schema.templates).where(eq(schema.templates.id, created.templateId)).limit(1)
  const freshText = fresh?.sourceFileKey ? await extractPdfText(await getStorage().get(fresh.sourceFileKey)) : ''
  console.log(freshText.includes(EXPECT) ? '✓ the stored file carries the new text' : '✗ the stored file does NOT carry the new text')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
