import type { PresetView } from '@/server/reports/engine/types'

/**
 * The working views: what a person opens in the morning. Each one is a
 * report definition with a name — open it, change it, save it under another
 * name. They use only registry field keys, never SQL.
 */
export const PRESET_VIEWS: PresetView[] = [
  {
    key: 'invited_not_registered',
    label: 'הוזמנו ולא נרשמו',
    blurb: 'קיבלו קישור אישי ועדיין לא מילאו את הטופס.',
    definition: { entity: 'people', clauses: [{ any: [{ field: 'process_status', op: 'is', value: 'invited' }] }], columns: ['name', 'phone', 'campaign', 'invite_channel', 'invited_by', 'last_activity_at'], sort: { field: 'last_activity_at', dir: 'desc' } },
  },
  {
    key: 'registered_not_signed',
    label: 'נרשמו ולא חתמו',
    blurb: 'מילאו את הטופס, ההסכם עדיין לא נחתם.',
    definition: { entity: 'people', clauses: [{ any: [{ field: 'process_status', op: 'one_of', value: ['registered', 'awaiting_signature'] }] }], columns: ['name', 'phone', 'campaign', 'process_status', 'agreement_status', 'assignee', 'last_activity_at'], sort: { field: 'last_activity_at', dir: 'desc' } },
  },
  {
    key: 'awaiting_signature',
    label: 'ממתינים לחתימה',
    blurb: 'הסכמים שנשלחו ולא נחתמו — כאן שולחים תזכורות.',
    definition: { entity: 'agreements', clauses: [{ any: [{ field: 'status', op: 'one_of', value: ['sent', 'viewed'] }] }], columns: ['title', 'company', 'recipient_name', 'recipient_phone', 'campaign', 'sent_at', 'last_send_result'], sort: { field: 'sent_at', dir: 'desc' } },
  },
  {
    key: 'signed_not_setup',
    label: 'חתמו וטרם הוקמו באתר',
    blurb: 'ההסכם נחתם, המוצר עדיין לא הוקם.',
    definition: { entity: 'tasks', clauses: [{ any: [{ field: 'kind', op: 'is', value: 'site_product' }] }, { any: [{ field: 'status', op: 'one_of', value: ['pending', 'in_progress'] }] }], columns: ['company', 'campaign', 'status', 'assignee', 'due_at', 'signed_at', 'link'], sort: { field: 'signed_at', dir: 'asc' } },
  },
  {
    key: 'follow_up_today',
    label: 'לחזור אליהם היום',
    blurb: 'תאריך החזרה הגיע — טלפון, ואז עדכון התוצאה.',
    definition: { entity: 'people', clauses: [{ any: [{ field: 'follow_up_at', op: 'before', value: 'tomorrow' }] }, { any: [{ field: 'process_status', op: 'not_one_of', value: ['signed', 'failed'] }] }], columns: ['name', 'phone', 'campaign', 'process_status', 'assignee', 'follow_up_at', 'call_outcome', 'internal_note'], sort: { field: 'follow_up_at', dir: 'asc' } },
  },
  {
    key: 'needs_attention',
    label: 'דורשים טיפול',
    blurb: 'הודעה שנכשלה, קישור שפג או הרשמה שלא שויכה — עם הפעולה המתאימה.',
    definition: { entity: 'agreements', clauses: [{ any: [{ field: 'attention', op: 'is', value: true }] }], columns: ['title', 'company', 'recipient_name', 'status', 'attention_reason', 'campaign', 'sent_at'], sort: { field: 'sent_at', dir: 'desc' } },
  },
  {
    key: 'completed',
    label: 'הושלמו',
    blurb: 'נחתמו, וכשיש משימת המשך — גם היא הושלמה.',
    definition: { entity: 'agreements', clauses: [{ any: [{ field: 'status', op: 'is', value: 'signed' }] }, { any: [{ field: 'task_status', op: 'one_of', value: ['done', 'not_needed'] }, { field: 'task_status', op: 'is_empty' }] }], columns: ['title', 'company', 'recipient_name', 'campaign', 'completed_at', 'task_status'], sort: { field: 'completed_at', dir: 'desc' } },
  },
]

/** The owner's binding example: tourism suppliers who signed and are not set up yet. */
export const TOURISM_EXAMPLE_COLUMNS = ['name', 'tax_id', 'contact_name', 'contact_phone', 'contact_email', 'signed_at', 'tags', 'assignee', 'task_status', 'task_link']
