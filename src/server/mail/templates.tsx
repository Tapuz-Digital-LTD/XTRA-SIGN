import { Text } from '@react-email/components'
import type { EmailBrand } from './brand'
import { Cta, Facts, Layout, Paragraphs, SecondaryLinks, styles } from './Layout'

/**
 * Every email XTRA Sign sends, as one component each. The words come in
 * already resolved — the message templates and their variables are the
 * caller's business — so these only lay them out.
 */

type Common = { brand?: EmailBrand | null }

const support = (brand?: EmailBrand | null, organizationName?: string | null) => {
  const who = organizationName ?? brand?.name
  if (!who) return null
  return brand?.supportEmail ? `לשאלות ניתן לפנות אל ${who}: ${brand.supportEmail}` : `לשאלות ניתן לפנות אל ${who}.`
}

// ── to the signer ─────────────────────────────────────────────────────────

export function InvitationEmail(props: Common & { title: string; body: string; cta: string; signingUrl: string; facts: { label: string; value: string }[]; organizationName?: string | null }) {
  return (
    <Layout brand={props.brand} preview={props.title} title={props.title} supportLine={support(props.brand, props.organizationName)} mistakeLine>
      <Paragraphs text={props.body} />
      <Facts rows={props.facts} />
      <Cta href={props.signingUrl} label={props.cta} color={props.brand?.color} />
      <Text style={styles.muted}>הקישור אישי ומיועד לך בלבד.</Text>
    </Layout>
  )
}

export function ReminderEmail(props: Common & { title: string; body: string; cta: string; signingUrl: string | null; facts: { label: string; value: string }[]; organizationName?: string | null }) {
  return (
    <Layout brand={props.brand} preview={props.title} title={props.title} supportLine={support(props.brand, props.organizationName)} mistakeLine>
      <Paragraphs text={props.body} />
      <Facts rows={props.facts} />
      {props.signingUrl ? <Cta href={props.signingUrl} label={props.cta} color={props.brand?.color} /> : <Text style={styles.muted}>הקישור לחתימה נשלח אליך בהודעה הקודמת.</Text>}
    </Layout>
  )
}

export function SignedConfirmationEmail(props: Common & { title: string; body: string; cta: string; downloadUrl: string; facts: { label: string; value: string }[]; note?: string | null; organizationName?: string | null }) {
  return (
    <Layout brand={props.brand} preview={props.title} title={props.title} success supportLine={support(props.brand, props.organizationName)}>
      <Paragraphs text={props.body} />
      <Facts rows={props.facts} />
      <Cta href={props.downloadUrl} label={props.cta} color={props.brand?.color} />
      {props.note ? <Text style={styles.muted}>{props.note}</Text> : null}
      <Text style={styles.muted}>הקישור להורדה מאובטח ומיועד למסמך הזה בלבד.</Text>
    </Layout>
  )
}

// ── to the team ───────────────────────────────────────────────────────────

export function NewRegistrationEmail(props: Common & { title: string; body: string; facts: { label: string; value: string; dir?: 'ltr' | 'rtl' }[]; openUrl: string; signedUrl?: string | null }) {
  return (
    <Layout brand={props.brand} preview={props.body} title={props.title}>
      <Text style={styles.text}>{props.body}</Text>
      <Facts rows={props.facts} />
      <Cta href={props.openUrl} label="צפייה בליד במערכת" color={props.brand?.color} />
      {props.signedUrl ? <SecondaryLinks links={[{ label: 'ההסכם החתום', href: props.signedUrl }]} color={props.brand?.color} /> : null}
    </Layout>
  )
}

export function SignedTeamEmail(props: Common & { title: string; body: string; facts: { label: string; value: string; dir?: 'ltr' | 'rtl' }[]; viewUrl: string; links: { label: string; href: string }[] }) {
  return (
    <Layout brand={props.brand} preview={props.body} title={props.title} success>
      <Text style={styles.text}>{props.body}</Text>
      <Facts rows={props.facts} />
      <Cta href={props.viewUrl} label="צפייה בהסכם" color={props.brand?.color} />
      <SecondaryLinks links={props.links} color={props.brand?.color} />
    </Layout>
  )
}

export type AttentionRow = { document: string; company: string | null; recipient: string | null; status: string; when: string; url: string }

/** "Still waiting" and "about to lapse", as a readable list rather than a dump. */
export function AttentionEmail(props: Common & { title: string; intro: string; sections: { heading: string; rows: AttentionRow[] }[]; openUrl: string }) {
  return (
    <Layout brand={props.brand} preview={props.intro} title={props.title}>
      <Text style={styles.text}>{props.intro}</Text>
      {props.sections.map((section) => (
        <div key={section.heading}>
          <Text style={{ ...styles.text, fontWeight: 700, margin: '16px 0 4px' }}>{section.heading}</Text>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {section.rows.map((r) => (
                <tr key={r.url}>
                  <td style={{ padding: '10px 0', borderTop: '1px solid #e5e7eb' }}>
                    <a href={r.url} style={{ color: '#111827', fontWeight: 700, textDecoration: 'none', fontSize: '15px' }}>
                      {r.document}
                    </a>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                      {[r.company, r.recipient].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ fontSize: '13px', color: '#374151', marginTop: '2px' }}>
                      {r.status} · {r.when}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Cta href={props.openUrl} label="פתח במערכת" color={props.brand?.color} />
    </Layout>
  )
}

/** Everything else the system says: one title, one line, one button. */
export function NoticeEmail(props: Common & { title: string; body?: string | null; facts?: { label: string; value: string }[]; ctaLabel: string; ctaUrl: string }) {
  return (
    <Layout brand={props.brand} preview={props.body ?? props.title} title={props.title}>
      {props.body ? <Text style={styles.text}>{props.body}</Text> : null}
      <Facts rows={props.facts ?? []} />
      <Cta href={props.ctaUrl} label={props.ctaLabel} color={props.brand?.color} />
    </Layout>
  )
}
