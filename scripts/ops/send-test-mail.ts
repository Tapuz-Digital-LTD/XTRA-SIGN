import { SAMPLE_VARIABLES } from '../../src/lib/message-template'
import { signerConfirmationEmail } from '../../src/server/notifications/campaign-mail'
import { InforuEmailProvider } from '../../src/server/notifications/inforu'

/**
 * One real email to yourself, with sample data, to check the design in a
 * real mail client (Gmail, Outlook, phone). Never to anyone else.
 *
 *   TO=you@xtra.co.il SIGN_PUBLIC_URL=https://xtra-sign.vercel.app npx dotenv-cli -e .env.local -- npx tsx scripts/ops/send-test-mail.ts
 */
const TO = process.env.TO ?? ''
if (!/^[^\s@]+@xtra\.co\.il$/i.test(TO)) throw new Error('TO must be an @xtra.co.il address (your own)')

async function main() {
  const mail = await signerConfirmationEmail({
    vars: { ...SAMPLE_VARIABLES, document_name: 'הסכם השתתפות (דיגיטלי) — חודש התיירות הישראלית 2026', signer_name: 'תומר', signed_document_link: 'https://xtra-sign.vercel.app/tourism-2026', organization_name: 'XTRA', signed_at: new Date().toLocaleDateString('he-IL') },
  })
  const result = await new InforuEmailProvider().send({ to: TO, subject: `[בדיקת עיצוב] ${mail.subject}`, text: mail.text, html: mail.html })
  console.log(result.ok ? `sent to ${TO} (id ${result.providerMessageId})` : `failed: ${result.error}`)
  process.exit(result.ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
