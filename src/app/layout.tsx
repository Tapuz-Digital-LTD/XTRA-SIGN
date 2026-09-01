import type { Metadata } from 'next'
import { Assistant } from 'next/font/google'
import './globals.css'

/**
 * Assistant covers Hebrew and Latin in one family, so mixed strings
 * ("הסכם ספק · PDF") keep one set of metrics instead of falling back mid-line.
 */
const assistant = Assistant({
  subsets: ['hebrew', 'latin'],
  variable: '--font-assistant',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'XTRA SIGN',
  description: 'מסמכים לחתימה',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * dir="rtl" on <html> plus Tailwind's logical properties (ms-/me-/ps-/pe-/
   * start-/end-) is the whole RTL implementation. The other XTRA apps carry
   * emotion + stylis-plugin-rtl to do what the browser already does.
   */
  return (
    <html lang="he" dir="rtl" className={assistant.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
