import type { Metadata, Viewport } from 'next'
import { shareForSlug } from '@/server/projects/share'
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

/**
 * What a shared link shows: the campaign's own share card (title, line,
 * picture), rendered on the server so WhatsApp, Facebook and every other
 * crawler sees it without running a line of JavaScript. Aliases of the
 * address resolve to the same card and point at the current address.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const share = await shareForSlug(slug).catch(() => null)
  if (!share) return { title: 'XTRA Sign', robots: { index: false, follow: false } }
  const images = share.imageUrl ? [{ url: share.imageUrl, width: 1200, height: 630, alt: share.title }] : []
  return {
    title: share.title,
    description: share.description || undefined,
    alternates: { canonical: share.canonicalUrl },
    openGraph: { type: 'website', title: share.title, description: share.description || undefined, url: share.canonicalUrl, siteName: share.campaignName, locale: 'he_IL', images },
    twitter: { card: images.length ? 'summary_large_image' : 'summary', title: share.title, description: share.description || undefined, images: images.map((i) => i.url) },
    robots: { index: true, follow: true },
  }
}

export const viewport: Viewport = {
  themeColor: '#0c3257',
  width: 'device-width',
  initialScale: 1,
}

export default function TourismLayout({ children }: { children: React.ReactNode }) {
  return <div className={`tl-root ${heebo.variable}`}>{children}</div>
}
