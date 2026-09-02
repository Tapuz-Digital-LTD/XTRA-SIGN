import { getDashboardOverview } from '@/server/dashboard/overview'
import { createDocumentFromTemplate } from '@/server/templates/templates'
import { listNotifications, markRead } from '@/server/notifications/notifications'
import { countDocuments, listDocuments, type ListFilter } from '@/server/documents/queries'
import { resendAgreement, sendAgreement } from '@/server/documents/send-agreement'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { getDocumentDetail } from '@/server/documents/queries'
import type { StaffSession } from '@/server/auth/session'
import { defineTool, isIdError, requireId, schema, str } from '../registry'

/**
 * One document, but only if this session may see it.
 *
 * `getDocumentDetail` takes a bare id and does no scoping of its own, so the
 * authorization has to happen here rather than being assumed.
 */
async function authorizedDocument(session: StaffSession, documentId: string) {
  try {
    await authorizeAgreementAccess(session, documentId)
  } catch {
    return null
  }
  return getDocumentDetail(documentId)
}

/**
 * Documents, sending, and the numbers on the dashboard.
 *
 * Sending is 'critical' and reminders are 'confirm': both put a message in
 * front of a real person, and an assistant that can do either without being
 * asked twice is one nobody should be given.
 */

const MAX_ROWS = 50
const FILTERS: ListFilter[] = ['all', 'drafts', 'pending', 'signed', 'viewed', 'attention']

export const searchDocuments = defineTool<{ query?: string; filter?: ListFilter; companyId?: string }>({
  name: 'search_documents',
  description:
    'Find documents by title or company, optionally narrowed to drafts, pending signature, signed, viewed-but-unsigned, or needing attention.',
  risk: 'safe',
  input: schema({
    query: str('Free text: document title or company name'),
    filter: { type: 'string', enum: FILTERS, description: 'סינון לפי מצב' },
    companyId: str('Restrict to one company'),
  }),
  async run(input, { session }) {
    const result = await listDocuments(session, {
      search: input.query,
      filter: input.filter ?? 'all',
      companyId: input.companyId,
      pageSize: MAX_ROWS,
    })
    return {
      summary: result.items.length ? `נמצאו ${result.items.length} מסמכים.` : 'לא נמצאו מסמכים.',
      data: {
        kind: 'documents',
        rows: result.items.map((doc) => ({
          id: doc.id,
          title: doc.title,
          status: doc.status,
          companyName: doc.company?.name ?? null,
          recipientName: doc.recipientName,
          href: `/documents/${doc.id}`,
        })),
      },
    }
  },
})

export const getDocumentStatus = defineTool<{ documentId: string }>({
  name: 'get_document_status',
  description: 'Where one document stands: its status, its recipient, and whether it was signed.',
  risk: 'safe',
  input: schema({ documentId: str('Document id') }, ['documentId']),
  async run({ documentId }, { session }) {
    const checked = requireId(documentId, 'המסמך')
    if (isIdError(checked)) return checked
    documentId = checked

    // Authorized first, then read: the detail reader takes a bare id, so the
    // access check has to be the explicit one rather than a side effect.
    const doc = await authorizedDocument(session, documentId)
    if (!doc) return { summary: 'המסמך לא נמצא.' }

    return {
      summary: `${doc.title} · ${doc.status}`,
      target: { type: 'document', id: doc.id },
      data: {
        kind: 'documents',
        rows: [
          {
            id: doc.id,
            title: doc.title,
            status: doc.status,
            companyName: doc.company?.name ?? null,
            recipientName: doc.recipient?.name ?? null,
            href: `/documents/${doc.id}`,
          },
        ],
      },
    }
  },
})

export const createFromTemplate = defineTool<{ templateId: string; companyId: string }>({
  name: 'create_document_from_template',
  description:
    'Make a new draft for one company from a saved template. The draft is not sent — it opens for review.',
  risk: 'safe',
  input: schema({ templateId: str('Template id'), companyId: str('Company id') }, [
    'templateId',
    'companyId',
  ]),
  async run({ templateId, companyId }, { session, ip, userAgent }) {
    const template = requireId(templateId, 'התבנית')
    if (isIdError(template)) return template
    const company = requireId(companyId, 'החברה')
    if (isIdError(company)) return company
    templateId = template
    companyId = company

    const result = await createDocumentFromTemplate({
      session,
      templateId,
      companyId,
      ip,
      userAgent,
    })
    if (!result.ok) return { summary: result.message }
    return {
      summary: 'נוצרה טיוטה. אפשר לפתוח, לבדוק ולשלוח.',
      target: { type: 'document', id: result.agreementId },
      data: { kind: 'link', href: `/documents/${result.agreementId}`, label: 'פתח מסמך' },
    }
  },
})

export const sendDocument = defineTool<{ documentId: string; channels?: ('sms' | 'email')[] }>({
  name: 'send_document',
  description:
    'Send one document for signature. This puts a real message in front of a real person. Requires approval.',
  risk: 'critical',
  input: schema(
    {
      documentId: str('Document id'),
      channels: { type: 'array', items: { type: 'string', enum: ['sms', 'email'] }, description: 'ערוצי שליחה' },
    },
    ['documentId'],
  ),
  async preview({ documentId, channels }, { session }) {
    const doc = await authorizedDocument(session, documentId)
    const via = (channels ?? ['sms']).join(' + ')
    return `שליחת "${doc?.title ?? 'המסמך'}" ל${doc?.recipient?.name ?? 'נמען'} דרך ${via}`
  },
  async run({ documentId, channels }, { session }) {
    const result = await sendAgreement({
      session,
      agreementId: documentId,
      channels: channels?.length ? channels : ['sms'],
    })
    if (!result.ok) return { summary: `לא ניתן לשלוח: ${result.blockers.join(', ')}` }
    return {
      summary: 'המסמך נשלח לחתימה.',
      target: { type: 'document', id: documentId },
      data: { kind: 'link', href: `/documents/${documentId}`, label: 'מעקב אחרי המסמך' },
    }
  },
})

export const sendReminder = defineTool<{ documentId: string; channels?: ('sms' | 'email')[] }>({
  name: 'send_reminder',
  description: 'Resend the signing link to someone who has not signed yet.',
  risk: 'confirm',
  input: schema(
    {
      documentId: str('Document id'),
      channels: { type: 'array', items: { type: 'string', enum: ['sms', 'email'] }, description: 'ערוצי שליחה' },
    },
    ['documentId'],
  ),
  preview: () => 'שליחת תזכורת לחתימה',
  async run({ documentId, channels }, { session }) {
    const result = await resendAgreement({
      session,
      agreementId: documentId,
      channels: channels?.length ? channels : ['sms'],
    })
    if (!result.ok) return { summary: result.message ?? 'שליחת התזכורת נכשלה.' }
    return { summary: 'התזכורת נשלחה.', target: { type: 'document', id: documentId } }
  },
})

export const remindEveryoneUnsigned = defineTool<{ companyId?: string; groupId?: string }>({
  name: 'remind_all_unsigned',
  description:
    'Send a reminder to everyone with an outstanding signature. Optionally limited to one company. Requires approval.',
  risk: 'critical',
  input: schema({ companyId: str('Limit to one company') }),
  async preview({ companyId }, { session }) {
    const pending = await listDocuments(session, { filter: 'pending', companyId, pageSize: MAX_ROWS })
    return `שליחת תזכורת ל-${pending.items.length} נמענים שטרם חתמו`
  },
  async run({ companyId }, { session }) {
    const pending = await listDocuments(session, { filter: 'pending', companyId, pageSize: MAX_ROWS })

    let sent = 0
    const failed: string[] = []
    for (const doc of pending.items) {
      const result = await resendAgreement({ session, agreementId: doc.id, channels: ['sms'] })
      if (result.ok) sent += 1
      else failed.push(doc.title)
    }

    return {
      summary: failed.length
        ? `נשלחו ${sent} תזכורות, ${failed.length} נכשלו.`
        : `נשלחו ${sent} תזכורות.`,
      data: { kind: 'reminders', sent, failed },
    }
  },
})

export const getDashboardSummary = defineTool<Record<string, never>>({
  name: 'get_dashboard_summary',
  description: 'The headline numbers: waiting, signed today, viewed but unsigned, needing attention.',
  risk: 'safe',
  input: schema({}),
  async run(_input, { session }) {
    const overview = await getDashboardOverview(session)
    return {
      summary: `${overview.counts.pending} ממתינים · ${overview.signedToday} נחתמו היום · ${overview.viewedNotSigned} נצפו ולא נחתמו · ${overview.attentionCount} דורשים טיפול.`,
      data: { kind: 'dashboard', overview },
    }
  },
})

export const getRequiresAttention = defineTool<Record<string, never>>({
  name: 'get_requires_attention',
  description: 'The documents that need someone to do something — failed sends, expiries, rejections.',
  risk: 'safe',
  input: schema({}),
  async run(_input, { session }) {
    const result = await listDocuments(session, { filter: 'attention', pageSize: MAX_ROWS })
    return {
      summary: result.items.length ? `${result.items.length} מסמכים דורשים טיפול.` : 'אין מסמכים שדורשים טיפול.',
      data: {
        kind: 'documents',
        rows: result.items.map((doc) => ({
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

export const getUnreadNotifications = defineTool<Record<string, never>>({
  name: 'get_unread_notifications',
  description: 'Recent notifications and how many are unread.',
  risk: 'safe',
  input: schema({}),
  async run(_input, { session }) {
    const { items, unread } = await listNotifications(session, 20)
    return {
      summary: unread ? `${unread} התראות שלא נקראו.` : 'אין התראות חדשות.',
      data: { kind: 'notifications', unread, rows: items },
    }
  },
})

export const markNotificationRead = defineTool<{ notificationId?: string }>({
  name: 'mark_notification_read',
  description: 'Mark one notification, or all of them, as read.',
  risk: 'safe',
  input: schema({ notificationId: str('Leave empty to mark everything read') }),
  async run({ notificationId }, { session }) {
    await markRead(session, notificationId)
    return { summary: notificationId ? 'ההתראה סומנה כנקראה.' : 'כל ההתראות סומנו כנקראו.' }
  },
})
