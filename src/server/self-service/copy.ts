import { DEFAULT_MESSAGES, renderTemplate } from '@/lib/message-template'
import type { SelfServiceSkin } from '@/lib/self-service-skins'
import type { LinkCopy } from '@/server/documents/send-agreement'
import { renderEmail } from '@/server/mail/render'
import { InvitationEmail, SignedConfirmationEmail } from '@/server/mail/templates'

/**
 * The words a self-service campaign sends around a registration.
 *
 * The campaign's name is the project's name, so a next-year project changes
 * the copy without a deploy; the colours come with the mail context (the
 * campaign's skin), the layout is the shared one.
 */

export function signingLinkCopy(project: { projectName: string }, _skin: SelfServiceSkin): LinkCopy {
  const t = DEFAULT_MESSAGES.registration_completed
  return {
    sms: (name, url) => renderTemplate(t.sms!, { signer_name: name, campaign_name: project.projectName, signing_link: url }).text,
    email: async (name, title, url, ctx) => {
      const vars = { signer_name: name, campaign_name: project.projectName, document_name: title, signing_link: url, organization_name: ctx.organizationName }
      return renderEmail(
        renderTemplate(t.email!.subject, vars).text,
        InvitationEmail({
          brand: ctx.brand,
          title: 'ההרשמה התקבלה — נותר לחתום',
          body: renderTemplate(t.email!.body, vars).text,
          cta: t.email!.cta ?? 'לצפייה וחתימה',
          signingUrl: url,
          facts: [
            { label: 'קמפיין', value: project.projectName },
            { label: 'מסמך', value: title },
          ],
          organizationName: ctx.organizationName,
        }),
      )
    },
  }
}

/** "You already signed": the copy is on its way, through the campaign's own thank-you page. */
export function signedCopyCopy(project: { projectName: string }, _skin: SelfServiceSkin) {
  const campaign = project.projectName
  return {
    sms: (name: string, url: string) => `שלום ${name}, הסכם ההשתתפות שלכם ב${campaign} כבר נחתם. להורדת העותק החתום: ${url}`,
    email: async (name: string, url: string, ctx: { organizationName: string; brand: import('@/server/mail/brand').EmailBrand }) =>
      renderEmail(
        `ההסכם החתום שלכם – ${campaign}`,
        SignedConfirmationEmail({
          brand: ctx.brand,
          title: 'ההסכם כבר נחתם',
          body: `שלום ${name},\n\nהסכם ההשתתפות שלכם ב${campaign} נחתם בעבר. העותק החתום זמין להורדה בקישור המאובטח.`,
          cta: 'הורדת ההסכם החתום',
          downloadUrl: url,
          facts: [{ label: 'קמפיין', value: campaign }],
          organizationName: ctx.organizationName,
        }),
      ),
  }
}
