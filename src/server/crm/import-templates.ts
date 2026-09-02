import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { buildTemplateStorageKey, validateUpload } from '@/server/documents/file-validation'
import { getStorage } from '@/server/storage/blob'
import { AUDIT_EVENTS, recordAdminAction } from '@/server/users/admin-audit'
import { FireberryProvider } from './fireberry'
import { sanitizeTemplateHtml } from './html-sanitize'
import { inlineAssets } from './inline-assets'
import { renderHtmlToPdf } from './html-to-pdf'

/**
 * Importing a Fireberry print template into XTRA Sign.
 *
 * The template arrives as HTML. It is converted to a PDF once, here, and from
 * that moment it is an ordinary XTRA Sign template: the editor places fields on
 * it, documents are made from it, and nothing downstream knows or cares that it
 * was ever HTML.
 *
 * A snapshot, not a subscription. The images are embedded rather than linked,
 * and an imported template is never rewritten afterwards — if the template
 * changes in Fireberry, importing it again produces a *new* template beside the
 * old one, and every document already made from the old one is untouched.
 *
 * Identity is (organization, CRM template, content hash), enforced by a partial
 * unique index. Re-importing identical content is refused; importing an edited
 * template is a new version.
 */

const MAX_TEMPLATES_PER_CALL = 5

export type CrmTemplate = {
  id: string
  name: string
  boundObject: string | null
  modifiedOn: string | null
  /** A version of this template is already here. */
  imported: boolean
  /** The CRM says it changed after the newest version we hold. */
  updateAvailable: boolean
  /** How many versions of it we hold. */
  versions: number
}

export type ListResult = { ok: true; templates: CrmTemplate[] } | { ok: false; message: string }
export type ImportResult =
  | { ok: true; imported: number; skipped: number; failed: { name: string; reason: string }[] }
  | { ok: false; message: string }

/** SHA-256 of the body exactly as the CRM returned it. */
export function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/** The merge tokens in a body, in order of first appearance, de-duplicated. */
export function detectMergeTokens(html: string): string[] {
  const seen = new Set<string>()
  for (const match of html.matchAll(/\{\[!([^\]]{1,120})\]\}/g)) {
    const token = match[1].trim()
    if (token) seen.add(token)
  }
  return [...seen]
}

/** Every imported version we hold, keyed by CRM template id. */
async function importedVersions(session: StaffSession) {
  const rows = await getDb()
    .select({
      crmTemplateId: schema.templates.crmTemplateId,
      crmContentHash: schema.templates.crmContentHash,
      crmModifiedOn: schema.templates.crmModifiedOn,
    })
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.organizationId, session.organizationId),
        isNotNull(schema.templates.crmTemplateId),
      ),
    )

  const byTemplate = new Map<string, { hashes: Set<string>; newestModifiedOn: string | null; count: number }>()
  for (const row of rows) {
    if (!row.crmTemplateId) continue
    const entry = byTemplate.get(row.crmTemplateId) ?? { hashes: new Set(), newestModifiedOn: null, count: 0 }
    if (row.crmContentHash) entry.hashes.add(row.crmContentHash)
    if (row.crmModifiedOn && (!entry.newestModifiedOn || row.crmModifiedOn > entry.newestModifiedOn)) {
      entry.newestModifiedOn = row.crmModifiedOn
    }
    entry.count += 1
    byTemplate.set(row.crmTemplateId, entry)
  }
  return byTemplate
}

export async function listCrmTemplates(session: StaffSession): Promise<ListResult> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }

  let templates
  try {
    templates = await provider.listPrintTemplates()
  } catch {
    return { ok: false, message: 'לא הצלחנו לקרוא את רשימת התבניות מ-CRM.' }
  }

  const held = await importedVersions(session)

  return {
    ok: true,
    templates: templates.map((template) => {
      const entry = held.get(template.id)
      return {
        ...template,
        imported: Boolean(entry),
        // Cheap signal only: `modifiedon` moves when someone re-saves without
        // changing anything, so this can be a false positive. The hash check at
        // import time is what answers it truthfully.
        updateAvailable: Boolean(
          entry && template.modifiedOn && entry.newestModifiedOn && template.modifiedOn > entry.newestModifiedOn,
        ),
        versions: entry?.count ?? 0,
      }
    }),
  }
}

export async function importCrmTemplates(input: {
  session: StaffSession
  templateIds: string[]
}): Promise<ImportResult> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }
  if (input.templateIds.length === 0) return { ok: false, message: 'לא נבחרו תבניות לייבוא.' }
  if (input.templateIds.length > MAX_TEMPLATES_PER_CALL) {
    return { ok: false, message: `ניתן לייבא עד ${MAX_TEMPLATES_PER_CALL} תבניות בבת אחת.` }
  }

  const db = getDb()
  const held = await importedVersions(input.session)
  const storage = getStorage()

  let imported = 0
  let skipped = 0
  const failed: { name: string; reason: string }[] = []

  for (const templateId of input.templateIds) {
    let source: Awaited<ReturnType<FireberryProvider['getPrintTemplate']>>
    try {
      source = await provider.getPrintTemplate(templateId)
    } catch {
      failed.push({ name: templateId, reason: 'הקריאה מ-CRM נכשלה' })
      continue
    }
    if (!source) {
      failed.push({ name: templateId, reason: 'התבנית לא נמצאה ב-CRM' })
      continue
    }

    // Hash the body exactly as fetched: the identity of a version is the CRM's
    // content, not what our pipeline made of it.
    const hash = contentHash(source.body)
    if (held.get(templateId)?.hashes.has(hash)) {
      skipped += 1
      continue
    }

    let pdf: Buffer
    let renderedHtml: string
    try {
      const { html, images } = sanitizeTemplateHtml(source.body)
      const inlined = await inlineAssets(html, images)
      renderedHtml = inlined.html
      pdf = await renderHtmlToPdf(renderedHtml)
    } catch {
      failed.push({ name: source.name, reason: 'ההמרה ל-PDF נכשלה' })
      continue
    }

    // The same gate a browser upload goes through: a renderer that produced
    // something other than a PDF must not reach storage.
    const validation = validateUpload(pdf)
    if (!validation.ok) {
      failed.push({ name: source.name, reason: validation.message })
      continue
    }

    let pageCount: number
    try {
      pageCount = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount()
    } catch {
      failed.push({ name: source.name, reason: 'ה-PDF שנוצר אינו קריא' })
      continue
    }

    const newId = crypto.randomUUID()
    const pdfKey = buildTemplateStorageKey({
      organizationId: input.session.organizationId,
      templateId: newId,
      ext: 'pdf',
    })
    const htmlKey = buildTemplateStorageKey({
      organizationId: input.session.organizationId,
      templateId: newId,
      ext: 'html',
    })

    try {
      await storage.put(pdfKey, pdf, 'application/pdf')
      await storage.put(htmlKey, Buffer.from(renderedHtml, 'utf8'), 'text/html; charset=utf-8')
    } catch {
      failed.push({ name: source.name, reason: 'שמירת הקובץ נכשלה' })
      continue
    }

    try {
      await db.insert(schema.templates).values({
        id: newId,
        organizationId: input.session.organizationId,
        name: versionedName(source.name, held.get(templateId)?.count ?? 0),
        content: null,
        sourceFileKey: pdfKey,
        // No fields yet: the operator places them in the editor, which is the
        // one place a field is ever positioned.
        fields: [],
        pageCount,
        createdBy: input.session.userId,
        source: 'crm',
        crmTemplateId: templateId,
        crmModifiedOn: source.modifiedOn,
        crmContentHash: hash,
        crmMergeFields: detectMergeTokens(source.body),
        crmSourceHtmlKey: htmlKey,
      })
    } catch {
      // The partial unique index refused it: the same content is already here,
      // imported by someone else between the check above and now.
      skipped += 1
      continue
    }

    // An organization-scoped event: a template import belongs to no agreement,
    // and `audit_events` is per-agreement by design.
    await recordAdminAction({
      organizationId: input.session.organizationId,
      type: AUDIT_EVENTS.TEMPLATE_IMPORTED,
      actorEmail: input.session.email,
      metadata: { templateId: newId, crmTemplateId: templateId, crmContentHash: hash, name: source.name },
    })

    imported += 1
  }

  return { ok: true, imported, skipped, failed }
}

/** "הסכם ספקים" first, "הסכם ספקים (גרסה 2)" for the next import of the same template. */
function versionedName(name: string, existing: number): string {
  return existing === 0 ? name : `${name} (גרסה ${existing + 1})`
}
