import { FireberryProvider } from './fireberry'

/**
 * A Fireberry business document — a quote or an order — as XTRA Sign sees it.
 *
 * This is not a template. Quote 1758 already has its customer, its date, its
 * number and its line items; re-deriving them from a blank template would be
 * recomputing something that already exists, and would disagree with the CRM
 * the moment any rule differed. So the record is read as it stands, rendered
 * through the CRM's own print template, and frozen.
 *
 * Line items are a collection, not a scalar. Object 17 rows become repeated
 * copies of the template's own line row, in `itemorder`, so the table in the
 * PDF is the table in the CRM.
 */

const ORDER_OBJECT = 13
const ORDER_ITEM_OBJECT = 17

/** Object-17 fields. A row containing any of these is the repeating row. */
const ITEM_FIELDS = [
  'productname',
  'description',
  'itemquantity',
  'itemprice',
  'itemtotalprice',
  'tax',
  'pcfcurrency',
  'catalognumber',
  'pcfsystemfield104',
]

export type BusinessDocument = {
  id: string
  objectType: number
  number: string | null
  total: number | null
  createdOn: string | null
  accountName: string | null
  /** "הצעה 1758 · 11,000 ₪ · 07/03/2024" */
  label: string
}

/**
 * Fireberry record ids are GUIDs. Anything else is refused rather than
 * interpolated: these values go into a CRM query expression, where a stray
 * bracket or an `or` would change which records the filter matches.
 */
export function isCrmId(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

const money = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 })

function describe(number: string | null, total: number | null, createdOn: string | null): string {
  const parts = [number ? `הצעה ${number}` : 'הצעה']
  if (total != null) parts.push(`${money.format(total)} ₪`)
  if (createdOn) {
    const date = new Date(createdOn)
    if (!Number.isNaN(date.getTime())) {
      parts.push(new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date))
    }
  }
  return parts.join(' · ')
}

/** The quotes and orders belonging to one CRM company. */
export async function listBusinessDocuments(input: {
  crmObjectType: number
  crmRecordId: string
}): Promise<BusinessDocument[]> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return []
  if (!isCrmId(input.crmRecordId)) return []

  // Whether the company is the customer or the supplier on the order depends on
  // which object it is.
  const linkField = input.crmObjectType === 1 ? 'accountid' : 'pcfsuppliers'

  const batch = await provider.queryRecords({
    objectType: ORDER_OBJECT,
    fields: ['crmorderid', 'crmordernumber', 'totalamount', 'createdon', 'accountidname'],
    pageNumber: 1,
    pageSize: 50,
    query: `(${linkField} = ${input.crmRecordId})`,
    sortBy: 'createdon',
  })

  return batch.rows
    .map((row) => {
      const id = str(row.crmorderid)
      if (!id) return null
      const number = str(row.crmordernumber)
      const total = typeof row.totalamount === 'number' ? row.totalamount : null
      const createdOn = str(row.createdon)
      return {
        id,
        objectType: ORDER_OBJECT,
        number,
        total,
        createdOn,
        accountName: str(row.accountidname),
        label: describe(number, total, createdOn),
      }
    })
    .filter((d): d is BusinessDocument => d !== null)
    .reverse()
}

export type RenderedBusinessDocument = {
  html: string
  /** Every value that went into it, for the frozen snapshot. */
  values: Record<string, string>
  itemCount: number
  title: string
}

/**
 * Builds the document's HTML: the CRM's own template, filled from the record.
 *
 * Unresolved tokens are removed rather than left in place — a signer must never
 * receive `{[!pcfcity]}` — and what could not be resolved is reported through
 * the snapshot, where an empty value is visible.
 */
export async function renderBusinessDocument(input: {
  objectType: number
  recordId: string
}): Promise<RenderedBusinessDocument> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) throw new Error('CRM is not configured')
  if (!isCrmId(input.recordId)) throw new Error('invalid record id')

  const record = await provider.getRecord(input.objectType, input.recordId)
  if (!record) throw new Error('record not found')

  const templateId = str(record.printtemplateid)
  if (!templateId) throw new Error('no print template on this record')

  const template = await provider.getPrintTemplate(templateId)
  if (!template) throw new Error('print template not found')

  const items = await provider.queryRecords({
    objectType: ORDER_ITEM_OBJECT,
    fields: ['crmorderitemid', ...ITEM_FIELDS, 'itemorder'],
    pageNumber: 1,
    pageSize: 200,
    query: `(crmorderid = ${input.recordId})`,
    sortBy: 'itemorder',
  })

  let html = expandLineItems(template.body, items.rows)

  // Values for everything the template asks for, resolving lookups as needed.
  const values = await resolveValues(html, record, provider)
  html = html.replace(/\{\[!([^\]]{1,120})\]\}/g, (_match, token: string) => values[token.trim()] ?? '')

  return {
    html,
    values,
    itemCount: items.rows.length,
    title: `${template.name} ${str(record.crmordernumber) ?? ''}`.trim(),
  }
}

/**
 * Repeats the template's line row once per item.
 *
 * The row to repeat is the `<tr>` whose cells mention object-17 fields — the
 * same row Fireberry repeats when it prints. If no such row exists the template
 * simply has no line table, and the document renders unchanged.
 */
export function expandLineItems(html: string, items: Record<string, unknown>[]): string {
  const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
  const rows = html.match(rowPattern)
  if (!rows) return html

  const templateRow = rows.find((row) => ITEM_FIELDS.some((f) => row.includes(`{[!${f}]}`)))
  if (!templateRow) return html

  if (items.length === 0) return html.replace(templateRow, '')

  const rendered = items
    .map((item) =>
      templateRow.replace(/\{\[!([^\]]{1,120})\]\}/g, (whole, token: string) => {
        const key = token.trim()
        if (!ITEM_FIELDS.includes(key)) return whole // not an item field; resolved later
        const value = item[key]
        return value == null ? '' : escapeHtml(formatValue(value, key))
      }),
    )
    .join('')

  return html.replace(templateRow, rendered)
}

/** Fields whose numbers are money and read better grouped. */
const MONEY_FIELD = /(price|amount|total|sum|vat|tax|discount)/i

/**
 * Renders a CRM value the way a person expects to see it.
 *
 * Grouping is applied by what the field *is*, not by how large the number is:
 * 11,000 is a price and reads better grouped, while 1758 is a quote number and
 * "1,758" is simply wrong. An ISO timestamp becomes a date, because nobody
 * wants to read 2024-03-07T10:54:05 on an agreement.
 */
function formatValue(value: unknown, field?: string): string {
  if (typeof value === 'number') {
    return field && MONEY_FIELD.test(field)
      ? new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(value)
      : String(value)
  }

  const text = String(value)
  const iso = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.exec(text)
  if (iso) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
    }
  }
  return text
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Resolves every remaining token against the record, following `lookup_field`
 * traversal into the linked record when needed.
 */
async function resolveValues(
  html: string,
  record: Record<string, unknown>,
  provider: FireberryProvider,
): Promise<Record<string, string>> {
  const tokens = [...new Set([...html.matchAll(/\{\[!([^\]]{1,120})\]\}/g)].map((m) => m[1].trim()))]
  const values: Record<string, string> = {}
  const linkedCache = new Map<string, Record<string, unknown> | null>()

  for (const token of tokens) {
    const direct = record[token]
    if (direct != null && String(direct).trim() !== '') {
      values[token] = escapeHtml(formatValue(direct, token))
      continue
    }

    // "pcfsuppliers_pcfcity" — the field pcfcity on whatever pcfsuppliers points at.
    const underscore = token.indexOf('_')
    if (underscore > 0) {
      const lookup = token.slice(0, underscore)
      const target = token.slice(underscore + 1)
      const linkedId = str(record[lookup])
      if (linkedId) {
        const objectType = lookupObjectType(lookup)
        if (objectType) {
          const cacheKey = `${objectType}:${linkedId}`
          if (!linkedCache.has(cacheKey)) {
            linkedCache.set(cacheKey, await provider.getRecord(objectType, linkedId).catch(() => null))
          }
          const linked = linkedCache.get(cacheKey)
          const value = linked?.[target]
          if (value != null && String(value).trim() !== '') {
            values[token] = escapeHtml(formatValue(value, target))
            continue
          }
        }
      }
    }

    // Nothing to fill it with. Empty, never the raw token.
    values[token] = ''
  }

  return values
}

/** Which object a lookup field points at. */
function lookupObjectType(field: string): number | null {
  if (field === 'pcfsuppliers') return 1000
  if (field === 'accountid') return 1
  if (field === 'org') return 1
  return null
}
