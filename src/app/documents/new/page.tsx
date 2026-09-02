import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CompanyStep } from '@/components/documents/CompanyStep'
import { UseTemplateButton } from '@/components/documents/UseTemplateButton'
import { CrmDocumentImport } from '@/components/companies/CrmDocumentImport'
import { CrmBusinessImport } from '@/components/crm/CrmBusinessImport'
import { UploadCard } from '@/components/UploadCard'
import { getSession } from '@/server/auth/session'
import { getCompany } from '@/server/companies/companies'
import { crmRegistrationAvailable } from '@/server/companies/registration'
import { listTemplates } from '@/server/templates/templates'

/**
 * A new document starts with one question: who is it for?
 *
 * Step 1 chooses (or creates) the company; step 2 chooses where the document
 * comes from. Every path out of here carries the company, so a document cannot
 * be born unattached — which is also enforced server-side, this screen is just
 * the honest version of that rule.
 */
export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; template?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  // Confirm the company belongs to this organization before using it as context.
  const company = params.company ? await getCompany(session, params.company) : null

  if (!company) {
    return (
      <AppShell>
        <p className="text-xs text-muted">שלב 1 מתוך 2</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-fg">למי המסמך?</h1>
        <p className="mt-1 text-sm text-muted">כל מסמך שייך לספק או ללקוח, כדי שתמיד יהיה ברור איפה למצוא אותו.</p>
        <div className="mt-6 max-w-xl">
          <CompanyStep template={params.template} crmAvailable={crmRegistrationAvailable()} />
        </div>
      </AppShell>
    )
  }

  const templates = (await listTemplates(session)).filter((t) => t.pageCount !== null)
  const highlighted = params.template ?? null

  return (
    <AppShell>
      <p className="text-xs text-muted">שלב 2 מתוך 2</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-fg">מאיפה מתחילים?</h1>
        <p className="text-sm text-muted">
          עבור <span className="font-medium text-fg">{company.name}</span>
          {company.crmRecordId ? <span className="ms-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">CRM</span> : null}
          <Link href={params.template ? `/documents/new?template=${params.template}` : '/documents/new'} className="ms-3 text-brand underline-offset-4 hover:underline">
            החלפת חברה
          </Link>
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 className="text-base font-semibold text-fg">✏️ יצירה מאפס</h2>
          <p className="mt-1 text-sm text-muted">
            כתיבה, עיצוב ושדות חתימה במסך אחד — בלי קובץ ובלי שלב ביניים
          </p>
          <Link
            href={`/documents/new/write?company=${company.id}`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:border-brand"
          >
            כתיבת מסמך
          </Link>
        </div>

        <UploadCard companyId={company.id} />

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:col-span-2">
          <h2 className="text-base font-semibold text-fg">📋 מתבנית XTRA Sign</h2>
          {templates.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              עדיין אין תבניות שמורות. שומרים מסמך כתבנית מעמוד המסמך, ומכאן ואילך הוא זמין לשימוש חוזר.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {templates.map((template) => (
                <li key={template.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{template.name}</span>
                    <span className="block text-xs text-muted">
                      {[
                        template.pageCount ? `${template.pageCount} עמודים` : null,
                        template.fieldCount > 0 ? `${template.fieldCount} שדות` : null,
                        template.signatureCount === 0 ? 'דורשת הגדרת חתימה' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <UseTemplateButton
                    templateId={template.id}
                    companyId={company.id}
                    highlighted={highlighted === template.id}
                    label={highlighted === template.id ? 'המשך עם התבנית הזו' : 'שימוש בתבנית'}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {company.crmRecordId ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:col-span-2">
            <h2 className="text-base font-semibold text-fg">🔗 מסמך קיים מ-Fireberry</h2>
            <p className="mt-1 text-sm text-muted">
              קבצים שכבר מצורפים לרשומה של {company.name}, או הצעה/הזמנה קיימת עם כל השורות שבה.
              הייבוא אינו משנה דבר ב-CRM.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CrmDocumentImport companyId={company.id} />
              <CrmBusinessImport companyId={company.id} />
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
