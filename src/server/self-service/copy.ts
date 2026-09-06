import type { LinkCopy } from '@/server/documents/send-agreement'
import { publicBaseUrl } from '@/server/http/public-url'
import type { SelfServiceSkin } from '@/lib/self-service-skins'

/**
 * The words a self-service campaign sends.
 *
 * Campaign-branded, not XTRA-branded: the supplier joined the Ministry's
 * programme and should hear from it. The project's name is the campaign's
 * name, so a next-year project changes the copy without a deploy.
 */

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function signingLinkCopy(project: { projectName: string }, skin: SelfServiceSkin): LinkCopy {
  const campaign = project.projectName
  return {
    sms: (name, url) => `שלום ${name}, תודה שהצטרפתם ל${campaign}. לחתימה על הסכם ההשתתפות: ${url}`,
    email: (name, _title, url) => ({
      subject: `הסכם השתתפות – ${campaign}`,
      text: `שלום ${name},\n\nתודה על הצטרפותכם ל${campaign}.\nלהשלמת ההצטרפות יש לצפות ולחתום על הסכם ההשתתפות:\n${url}`,
      html: campaignEmail({
        skin,
        campaign,
        greeting: `שלום ${esc(name)},`,
        lines: [`תודה על הצטרפותכם ל${esc(campaign)}.`, 'להשלמת ההצטרפות יש לצפות ולחתום על הסכם ההשתתפות.'],
        cta: { label: 'לצפייה וחתימה', url },
      }),
    }),
  }
}

export function signedCopyCopy(project: { projectName: string }, skin: SelfServiceSkin) {
  const campaign = project.projectName
  return {
    sms: (name: string, url: string) =>
      `שלום ${name}, הסכם ההשתתפות שלכם ב${campaign} נחתם בהצלחה. להורדת העותק החתום: ${url}`,
    email: (name: string, url: string) => ({
      subject: `ההסכם החתום שלכם – ${campaign}`,
      text: `שלום ${name},\n\nהסכם ההשתתפות שלכם ב${campaign} נחתם בהצלחה.\nלהורדת העותק החתום:\n${url}`,
      html: campaignEmail({
        skin,
        campaign,
        greeting: `שלום ${esc(name)},`,
        lines: [`הסכם ההשתתפות שלכם ב${esc(campaign)} נחתם בהצלחה.`, 'העותק החתום זמין להורדה בקישור המאובטח שלמטה.'],
        cta: { label: 'הורדת ההסכם החתום', url },
      }),
    }),
  }
}

/** Inline styles only: every mail client strips a stylesheet. */
function campaignEmail(input: {
  skin: SelfServiceSkin
  campaign: string
  greeting: string
  lines: string[]
  cta: { label: string; url: string }
}): string {
  const logo = `${publicBaseUrl()}${input.skin.basePath}/email-logo.png`
  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0c3257;padding:24px 28px;text-align:center">
<img src="${esc(logo)}" alt="${esc(input.campaign)}" width="220" style="display:inline-block;max-width:220px;height:auto;border:0">
</td></tr>
<tr><td style="padding:28px;text-align:right;color:#0c3257;font-size:16px;line-height:1.7">
<p style="margin:0 0 12px;font-size:18px;font-weight:bold">${input.greeting}</p>
${input.lines.map((line) => `<p style="margin:0 0 12px">${line}</p>`).join('\n')}
<p style="margin:24px 0 0"><a href="${esc(input.cta.url)}" style="display:inline-block;background:#45b2ed;color:#0c3257;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:bold;font-size:16px">${esc(input.cta.label)}</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#64748b">הקישור אישי ואינו מיועד להעברה.</p>
</td></tr>
<tr><td style="background:#fc92c2;height:10px;font-size:0;line-height:0">&nbsp;</td></tr>
</table></td></tr></table></body></html>`
}
