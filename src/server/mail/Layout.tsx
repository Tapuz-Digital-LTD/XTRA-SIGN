import { Body, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { DEFAULT_BRAND, type EmailBrand } from './brand'

/**
 * The one frame every XTRA Sign email sits in.
 *
 * Header with the brand (logo when there is one, the name otherwise), a
 * white card with a title and a short body, a clear primary button, a
 * quiet footer. Full RTL, table-based through React Email so Gmail,
 * Outlook and phones all agree. A campaign brings its colours; the
 * default is XTRA Sign's own.
 */

export const styles = {
  body: { margin: 0, padding: 0, backgroundColor: '#f3f4f6', fontFamily: 'Arial, Helvetica, sans-serif' } as const,
  container: { maxWidth: '560px', margin: '0 auto', padding: '24px 12px' } as const,
  card: { backgroundColor: '#ffffff', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e5e7eb' } as const,
  header: { padding: '20px 28px', textAlign: 'center' as const },
  brandName: { margin: 0, fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '0.3px' } as const,
  content: { padding: '28px 28px 8px', textAlign: 'right' as const },
  title: { margin: '0 0 12px', fontSize: '22px', lineHeight: '1.35', color: '#111827', textAlign: 'center' as const } as const,
  text: { margin: '0 0 12px', fontSize: '16px', lineHeight: '1.75', color: '#374151' } as const,
  muted: { margin: '16px 0 0', fontSize: '13px', lineHeight: '1.7', color: '#6b7280', textAlign: 'center' as const } as const,
  footer: { padding: '20px 28px 28px', textAlign: 'center' as const, fontSize: '12px', lineHeight: '1.7', color: '#9ca3af' } as const,
  factLabel: { padding: '8px 0', borderTop: '1px solid #e5e7eb', fontSize: '13px', color: '#6b7280', width: '38%', verticalAlign: 'top' } as const,
  factValue: { padding: '8px 0', borderTop: '1px solid #e5e7eb', fontSize: '14px', color: '#111827', verticalAlign: 'top' } as const,
}

export function Layout({
  brand,
  preview,
  title,
  success,
  children,
  supportLine,
  mistakeLine = false,
}: {
  brand?: EmailBrand | null
  preview: string
  title: string
  /** A green check above the title. */
  success?: boolean
  children: ReactNode
  /** "לשאלות ניתן לפנות אל …" — the caller decides the wording. */
  supportLine?: string | null
  /** "אם קיבלת את ההודעה הזו בטעות, אפשר להתעלם ממנה." */
  mistakeLine?: boolean
}) {
  const b = brand ?? DEFAULT_BRAND
  const color = /^#[0-9a-f]{6}$/i.test(b.color ?? '') ? b.color! : DEFAULT_BRAND.color!
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section style={{ ...styles.header, backgroundColor: b.headerBackground ?? color, borderBottom: b.headerBackground ? '1px solid #e5e7eb' : undefined }}>
              {b.logoUrl ? (
                <Img src={b.logoUrl} alt={b.name} height={44} style={{ display: 'inline-block', height: '44px', width: 'auto', maxWidth: '220px' }} />
              ) : (
                <Text style={styles.brandName}>{b.name}</Text>
              )}
            </Section>
            <Section style={styles.content}>
              {success ? (
                <Section style={{ textAlign: 'center', paddingBottom: '12px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '56px',
                      height: '56px',
                      lineHeight: '56px',
                      borderRadius: '28px',
                      backgroundColor: '#dcfce7',
                      color: '#15803d',
                      fontSize: '30px',
                      textAlign: 'center',
                    }}
                  >
                    ✓
                  </span>
                </Section>
              ) : null}
              <Heading as="h1" style={styles.title}>
                {title}
              </Heading>
              {children}
            </Section>
            <Section style={styles.footer}>
              {supportLine ? <Text style={{ ...styles.footer, padding: 0, margin: '0 0 6px', color: '#6b7280' }}>{supportLine}</Text> : null}
              {mistakeLine ? <Text style={{ ...styles.footer, padding: 0, margin: '0 0 6px' }}>אם קיבלת את ההודעה הזו בטעות, אפשר להתעלם ממנה.</Text> : null}
              <Hr style={{ borderColor: '#e5e7eb', margin: '10px 0' }} />
              <Text style={{ ...styles.footer, padding: 0, margin: 0 }}>
                נשלח באמצעות{' '}
                <Link href="https://xtra-sign.vercel.app" style={{ color: '#9ca3af', textDecoration: 'underline' }}>
                  XTRA Sign
                </Link>
                {b.name !== DEFAULT_BRAND.name ? ` עבור ${b.name}` : ''}
              </Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

/** Label → value rows, the way a receipt reads. */
export function Facts({ rows }: { rows: { label: string; value: string; dir?: 'ltr' | 'rtl' }[] }) {
  if (rows.length === 0) return null
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: '12px 0 0', borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.label}:${r.value}`}>
            <td style={styles.factLabel}>{r.label}</td>
            <td style={{ ...styles.factValue, ...(r.dir === 'ltr' ? { direction: 'ltr', textAlign: 'left' } : {}) }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The primary button: big, centred, one per email. */
export function Cta({ href, label, color }: { href: string; label: string; color?: string | null }) {
  const bg = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : DEFAULT_BRAND.color!
  return (
    <Section style={{ textAlign: 'center', padding: '20px 0 8px' }}>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          padding: '14px 32px',
          borderRadius: '12px',
          backgroundColor: bg,
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        {label}
      </Link>
    </Section>
  )
}

/** Quiet links under the button. */
export function SecondaryLinks({ links, color }: { links: { label: string; href: string }[]; color?: string | null }) {
  if (links.length === 0) return null
  const c = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : DEFAULT_BRAND.color!
  return (
    <Text style={{ margin: '4px 0 0', fontSize: '14px', lineHeight: '1.9', textAlign: 'center' }}>
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 ? <span style={{ color: '#9ca3af' }}> · </span> : null}
          <Link href={l.href} style={{ color: c, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            {l.label}
          </Link>
        </span>
      ))}
    </Text>
  )
}

/** Plain copy with blank lines → paragraphs. */
export function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <Text key={i} style={styles.text}>
            {p.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </Text>
        ))}
    </>
  )
}
