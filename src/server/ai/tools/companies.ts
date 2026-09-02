import {
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  type CompanyKind,
} from '@/server/companies/companies'
import { listDocuments } from '@/server/documents/queries'
import { groupsForCompany } from '@/server/groups/groups'
import { defineTool, isIdError, requireId, schema, str } from '../registry'

/**
 * Suppliers and customers, through the very services the screens use.
 *
 * Nothing here touches the database directly, so tenant scoping, validation and
 * audit are the ones already written and tested — the assistant gets no shorter
 * path into the data than a person clicking the same buttons.
 */

const KIND = { type: 'string', enum: ['supplier', 'customer'], description: 'ספק או לקוח' }

/** A cap the model cannot raise: a search returning thousands of rows helps nobody. */
const MAX_ROWS = 50

export const searchCompanies = defineTool<{ query?: string; kind?: CompanyKind; limit?: number }>({
  name: 'search_companies',
  description:
    'Search suppliers or customers by name, tax id (ח.פ/ע.מ) or contact name. Only ever returns companies in the current organization.',
  risk: 'safe',
  input: schema({
    query: str('Free text: company name, tax id or contact name'),
    kind: KIND,
    limit: { type: 'number', description: 'Max rows, default 20' },
  }),
  async run(input, { session }) {
    const kinds: CompanyKind[] = input.kind ? [input.kind] : ['supplier', 'customer']
    const found = (
      await Promise.all(kinds.map((kind) => listCompanies(session, kind, input.query)))
    ).flat()
    const rows = found.slice(0, Math.min(Math.max(input.limit ?? 20, 1), MAX_ROWS))

    return {
      summary: rows.length
        ? `נמצאו ${found.length} תוצאות${found.length > rows.length ? `, מוצגות ${rows.length}` : ''}.`
        : 'לא נמצאו חברות מתאימות.',
      data: {
        kind: 'companies',
        rows: rows.map((company) => ({
          id: company.id,
          name: company.name,
          companyKind: company.kind,
          taxId: company.taxId,
          contactName: company.contactName,
          fromCrm: Boolean(company.crmRecordId),
          documentCount: company.documentCount,
          pendingCount: company.pendingCount,
          href: `/companies/${company.id}`,
        })),
      },
    }
  },
})

export const getCompanyTool = defineTool<{ companyId: string }>({
  name: 'get_company',
  description: 'Full details of one supplier or customer, including its groups.',
  risk: 'safe',
  input: schema({ companyId: str('The company id') }, ['companyId']),
  async run({ companyId }, { session }) {
    const id = requireId(companyId, 'החברה')
    if (isIdError(id)) return id

    const company = await getCompany(session, id)
    if (!company) return { summary: 'החברה לא נמצאה.' }
    const groups = await groupsForCompany(session, id)

    return {
      summary: `${company.name}${company.taxId ? ` · ח.פ ${company.taxId}` : ''}`,
      target: { type: 'company', id: company.id },
      data: {
        kind: 'companies',
        rows: [
          {
            id: company.id,
            name: company.name,
            companyKind: company.kind,
            taxId: company.taxId,
            contactName: company.contactName,
            contactPhone: company.contactPhone,
            contactEmail: company.contactEmail,
            fromCrm: Boolean(company.crmRecordId),
            groups: groups.map((group) => group.name),
            href: `/companies/${company.id}`,
          },
        ],
      },
    }
  },
})

export const createCompanyTool = defineTool<{
  name: string
  kind: CompanyKind
  taxId?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
}>({
  name: 'create_company',
  description:
    'Create a supplier or customer in XTRA Sign. Does not create anything in Fireberry.',
  risk: 'safe',
  input: schema(
    {
      name: str('Company name'),
      kind: KIND,
      taxId: str('ח.פ / ע.מ'),
      contactName: str('Contact person'),
      contactPhone: str('Contact phone, Israeli format'),
      contactEmail: str('Contact email'),
    },
    ['name', 'kind'],
  ),
  preview: (input) => `יצירת ${input.kind === 'supplier' ? 'ספק' : 'לקוח'} בשם "${input.name}"`,
  async run(input, { session }) {
    const result = await createCompany({
      session,
      kind: input.kind,
      data: {
        name: input.name,
        taxId: input.taxId ?? null,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
      },
    })
    if (!result.ok) return { summary: result.message }

    return {
      summary: `נוצר ${input.kind === 'supplier' ? 'ספק' : 'לקוח'}: ${input.name}.`,
      target: { type: 'company', id: result.id },
      data: {
        kind: 'companies',
        rows: [
          {
            id: result.id,
            name: input.name,
            companyKind: input.kind,
            contactName: input.contactName ?? null,
            href: `/companies/${result.id}`,
          },
        ],
      },
    }
  },
})

export const updateCompanyTool = defineTool<{
  companyId: string
  name?: string
  taxId?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
}>({
  name: 'update_company',
  description: 'Change a supplier or customer’s details.',
  risk: 'confirm',
  input: schema(
    {
      companyId: str('The company id'),
      name: str('Company name'),
      taxId: str('ח.פ / ע.מ'),
      contactName: str('Contact person'),
      contactPhone: str('Contact phone'),
      contactEmail: str('Contact email'),
    },
    ['companyId'],
  ),
  async preview({ companyId }, { session }) {
    const company = await getCompany(session, companyId)
    return `עדכון פרטי ${company?.name ?? 'החברה'}`
  },
  async run({ companyId, ...changes }, { session }) {
    // Read first so an unspecified field keeps its value rather than being
    // blanked: the update service replaces the whole record.
    const current = await getCompany(session, companyId)
    if (!current) return { summary: 'החברה לא נמצאה.' }

    const result = await updateCompany({
      session,
      companyId,
      data: {
        name: changes.name ?? current.name,
        taxId: changes.taxId ?? current.taxId,
        contactName: changes.contactName ?? current.contactName,
        contactPhone: changes.contactPhone ?? current.contactPhone,
        contactEmail: changes.contactEmail ?? current.contactEmail,
        notes: current.notes,
      },
    })
    if (!result.ok) return { summary: result.message }

    return {
      summary: `הפרטים של ${changes.name ?? current.name} עודכנו.`,
      target: { type: 'company', id: companyId },
      data: { kind: 'link', href: `/companies/${companyId}`, label: 'פתח כרטיס' },
    }
  },
})

export const listCompanyDocuments = defineTool<{ companyId: string }>({
  name: 'list_company_documents',
  description: 'The documents belonging to one supplier or customer, with their statuses.',
  risk: 'safe',
  input: schema({ companyId: str('The company id') }, ['companyId']),
  async run({ companyId }, { session }) {
    const id = requireId(companyId, 'החברה')
    if (isIdError(id)) return id

    const documents = await listDocuments(session, { companyId: id, filter: 'all', pageSize: MAX_ROWS })
    return {
      summary: documents.items.length ? `${documents.items.length} מסמכים.` : 'אין מסמכים לחברה הזו.',
      data: {
        kind: 'documents',
        rows: documents.items.map((doc) => ({
          id: doc.id,
          title: doc.title,
          status: doc.status,
          companyName: doc.company?.name ?? null,
          href: `/documents/${doc.id}`,
        })),
      },
    }
  },
})
