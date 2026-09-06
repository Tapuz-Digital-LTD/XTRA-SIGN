import type { Metadata, Viewport } from 'next'
import { Heebo } from 'next/font/google'
import './tourism.css'
import './campaign.css'

/**
 * The Ministry of Tourism campaign pages: call-for-suppliers, joining and
 * signing, thank-you. Campaign branding only — none of the XTRA Sign shell.
 */

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'קול קורא לעסקי תיירות — חודש התיירות הישראלית 2026',
  description:
    'קול קורא לעסקי תיירות להצטרף לחודש התיירות הישראלית, נובמבר 2026. הצטרפות, קריאת הסכם ההשתתפות וחתימה דיגיטלית בכמה דקות.',
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#0c3257',
  width: 'device-width',
  initialScale: 1,
}

export default function TourismLayout({ children }: { children: React.ReactNode }) {
  return <div className={`tl-root ${heebo.variable}`}>{children}</div>
}
