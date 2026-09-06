import { DEFAULT_MESSAGES, renderTemplate } from '@/lib/message-template'
import type { EmailBrand } from './brand'
import { renderEmail, type RenderedEmail } from './render'
import { AttentionEmail, InvitationEmail, NewRegistrationEmail, NoticeEmail, ReminderEmail, SignedConfirmationEmail, SignedTeamEmail } from './templates'

/**
 * Every email the system sends, with sample data — for the preview
 * screen, the test send, and the visual check. The samples are obviously
 * samples ("ישראל ישראלי"), so a test mail is never mistaken for a real one.
 */

export type MailTemplateKey = 'invitation' | 'reminder' | 'signed_confirmation' | 'new_registration' | 'signed_team' | 'attention' | 'notice'

export const MAIL_TEMPLATES: { key: MailTemplateKey; label: string; audience: 'signer' | 'team' }[] = [
  { key: 'invitation', label: 'מסמך לחתימה', audience: 'signer' },
  { key: 'reminder', label: 'תזכורת לחתימה', audience: 'signer' },
  { key: 'signed_confirmation', label: 'המסמך נחתם (לחותם)', audience: 'signer' },
  { key: 'new_registration', label: 'ליד / הרשמה חדשה', audience: 'team' },
  { key: 'signed_team', label: 'הסכם נחתם (לצוות)', audience: 'team' },
  { key: 'attention', label: 'מסמכים שממתינים / עומדים לפוג', audience: 'team' },
  { key: 'notice', label: 'הודעת מערכת כללית', audience: 'team' },
]

export function isMailTemplateKey(value: unknown): value is MailTemplateKey {
  return typeof value === 'string' && MAIL_TEMPLATES.some((t) => t.key === value)
}

const SAMPLE_VARS = {
  signer_name: 'ישראל ישראלי',
  document_name: 'הסכם השתתפות (דוגמה)',
  signing_link: 'https://example.invalid/sign/sample-token',
  signed_document_link: 'https://example.invalid/api/sign/sample-token/download',
  organization_name: 'הארגון שלך',
  company_name: 'מלון הדוגמה בע"מ',
  campaign_name: 'קמפיין לדוגמה',
  signed_at: '06/09/2026',
  expires_at: '06/10/2026',
}

export async function renderSample(key: MailTemplateKey, brand: EmailBrand | null, base = 'https://example.invalid'): Promise<RenderedEmail> {
  switch (key) {
    case 'invitation': {
      const t = DEFAULT_MESSAGES.invitation.email!
      return renderEmail(
        renderTemplate(t.subject, SAMPLE_VARS).text,
        InvitationEmail({
          brand,
          title: 'נשלח אליך מסמך לחתימה',
          body: renderTemplate(t.body, SAMPLE_VARS).text,
          cta: t.cta ?? 'לצפייה וחתימה',
          signingUrl: SAMPLE_VARS.signing_link,
          facts: [
            { label: 'מסמך', value: SAMPLE_VARS.document_name },
            { label: 'נשלח על ידי', value: SAMPLE_VARS.organization_name },
            { label: 'בתוקף עד', value: SAMPLE_VARS.expires_at },
          ],
          organizationName: SAMPLE_VARS.organization_name,
        }),
      )
    }
    case 'reminder': {
      const t = DEFAULT_MESSAGES.reminder.email!
      return renderEmail(
        renderTemplate(t.subject, SAMPLE_VARS).text,
        ReminderEmail({
          brand,
          title: 'תזכורת: המסמך עדיין ממתין לחתימתך',
          body: renderTemplate(t.body, SAMPLE_VARS).text,
          cta: 'להמשך חתימה',
          signingUrl: SAMPLE_VARS.signing_link,
          facts: [{ label: 'מסמך', value: SAMPLE_VARS.document_name }, { label: 'נשלח על ידי', value: SAMPLE_VARS.organization_name }],
          organizationName: SAMPLE_VARS.organization_name,
        }),
      )
    }
    case 'signed_confirmation': {
      const t = DEFAULT_MESSAGES.signed_confirmation.email!
      return renderEmail(
        renderTemplate(t.subject, SAMPLE_VARS).text,
        SignedConfirmationEmail({
          brand,
          title: 'החתימה הושלמה בהצלחה',
          body: renderTemplate(t.body, SAMPLE_VARS).text,
          cta: t.cta ?? 'הורדת המסמך החתום',
          downloadUrl: SAMPLE_VARS.signed_document_link,
          facts: [
            { label: 'מסמך', value: SAMPLE_VARS.document_name },
            { label: 'חותם', value: SAMPLE_VARS.signer_name },
            { label: 'תאריך חתימה', value: SAMPLE_VARS.signed_at },
          ],
          organizationName: SAMPLE_VARS.organization_name,
        }),
      )
    }
    case 'new_registration':
      return renderEmail(
        `ספק חדש נרשם – ${SAMPLE_VARS.campaign_name}`,
        NewRegistrationEmail({
          brand,
          title: `ספק חדש נרשם – ${SAMPLE_VARS.campaign_name}`,
          body: `${SAMPLE_VARS.company_name} השלים/ה הרשמה בקמפיין.`,
          facts: [
            { label: 'קמפיין', value: SAMPLE_VARS.campaign_name },
            { label: 'תאריך ושעת הרשמה', value: '6 בספט׳ 2026, 14:32' },
            { label: 'שם העסק / החברה', value: SAMPLE_VARS.company_name },
            { label: 'ח.פ. / ע.מ.', value: '515123456', dir: 'ltr' },
            { label: 'מורשה חתימה', value: SAMPLE_VARS.signer_name },
            { label: 'תפקיד', value: 'מנכ"ל' },
            { label: 'טלפון', value: '052-1234567', dir: 'ltr' },
            { label: 'אימייל', value: 'israel@example.co.il', dir: 'ltr' },
            { label: 'אזור', value: 'צפון' },
            { label: 'מקור ההגעה', value: 'Facebook / paid' },
          ],
          openUrl: `${base}/companies/sample`,
        }),
      )
    case 'signed_team':
      return renderEmail(
        `הסכם נחתם – ${SAMPLE_VARS.company_name}`,
        SignedTeamEmail({
          brand,
          title: `הסכם נחתם – ${SAMPLE_VARS.company_name}`,
          body: `"${SAMPLE_VARS.document_name}" נחתם.`,
          facts: [
            { label: 'קמפיין', value: SAMPLE_VARS.campaign_name },
            { label: 'שם העסק', value: SAMPLE_VARS.company_name },
            { label: 'ח.פ.', value: '515123456', dir: 'ltr' },
            { label: 'שם החותם', value: SAMPLE_VARS.signer_name },
            { label: 'תאריך ושעת חתימה', value: '6 בספט׳ 2026, 15:10' },
            { label: 'סטטוס', value: 'נחתם' },
          ],
          viewUrl: `${base}/documents/sample`,
          links: [
            { label: 'הורדת ההסכם החתום', href: `${base}/api/documents/sample/download` },
            { label: 'פתח את הספק', href: `${base}/companies/sample` },
          ],
        }),
      )
    case 'attention':
      return renderEmail(
        'סיכום יומי: 3 הסכמים דורשים תשומת לב',
        AttentionEmail({
          brand,
          title: 'הסכמים שדורשים תשומת לב',
          intro: 'סיכום הבוקר של XTRA Sign: מה עדיין ממתין, ומה עומד לפוג.',
          sections: [
            {
              heading: 'ממתינים לחתימה כבר 3 ימים ומעלה (2)',
              rows: [
                { document: 'הסכם השתתפות – מלון הדוגמה', company: SAMPLE_VARS.company_name, recipient: SAMPLE_VARS.signer_name, status: 'נצפה', when: 'נשלח לפני 5 ימים', url: `${base}/documents/a` },
                { document: 'הסכם השתתפות – צימר בגליל', company: 'צימר בגליל', recipient: 'דנה כהן', status: 'ממתין לחתימה', when: 'נשלח לפני 4 ימים', url: `${base}/documents/b` },
              ],
            },
            {
              heading: 'קישורים שיפוגו בשבוע הקרוב (1)',
              rows: [{ document: 'הסכם ספק – קפה בנגב', company: 'קפה בנגב', recipient: 'יוסי לוי', status: 'ממתין לחתימה', when: 'פג בעוד 3 ימים', url: `${base}/documents/c` }],
            },
          ],
          openUrl: `${base}/agreements?filter=pending`,
        }),
      )
    case 'notice':
      return renderEmail(
        'שליחה נכשלה: הסכם השתתפות – מלון הדוגמה',
        NoticeEmail({ brand, title: 'שליחה נכשלה', body: 'ה-SMS אל ישראל ישראלי לא נמסר (מספר לא תקין). אפשר לתקן את הפרטים ולשלוח שוב.', facts: [{ label: 'מסמך', value: SAMPLE_VARS.document_name }], ctaLabel: 'לצפייה במערכת', ctaUrl: `${base}/documents/sample` }),
      )
  }
}
