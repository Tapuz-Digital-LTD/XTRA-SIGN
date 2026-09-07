import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/LoginForm'
import { CAPTCHA_ACTIONS } from '@/lib/captcha'
import { getSession } from '@/server/auth/session'
import { captchaPublicConfig } from '@/server/security/captcha'

/**
 * The door. One card on a phone; on a desktop the same card beside a quiet
 * brand panel so the screen is not an empty field with a box in it.
 * `items-start` on short viewports keeps the card and its button reachable
 * with the keyboard open; nothing is fixed to the bottom.
 */
export default async function LoginPage() {
  if (await getSession()) redirect('/')

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="hidden bg-[radial-gradient(120%_120%_at_0%_0%,#1d4ed8_0%,#0c3257_60%,#071f38_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2" dir="ltr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="inline-flex items-center rounded-lg bg-white px-2.5 py-1.5"><img src="/xtra-logo.png" alt="XTRA" className="h-6 w-auto" /></span>
          <span className="text-lg font-bold tracking-wide">SIGN</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-bold leading-tight">הסכמים שנחתמים בדקות, לא בשבועות.</p>
          <ul className="mt-6 space-y-3 text-sm text-white/85">
            <li className="flex items-start gap-2"><span aria-hidden="true">✓</span> שליחה ב-SMS ובאימייל, חתימה מהנייד, עותק חתום לכולם.</li>
            <li className="flex items-start gap-2"><span aria-hidden="true">✓</span> אימות טלפוני חד-פעמי ומסלול ביקורת מלא לכל חתימה.</li>
            <li className="flex items-start gap-2"><span aria-hidden="true">✓</span> קמפיינים, הרשמות, הפצות ודוחות במקום אחד.</li>
          </ul>
        </div>
        <p className="text-xs text-white/60">XTRA Sign · חתימה דיגיטלית לעסקים</p>
      </aside>

      <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center sm:py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-2 lg:hidden" dir="ltr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/xtra-logo.png" alt="XTRA" className="h-8 w-auto" />
            <span className="text-lg font-bold tracking-wide text-fg">SIGN</span>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            <LoginForm captcha={await captchaPublicConfig(CAPTCHA_ACTIONS.LOGIN_OTP)} />
          </div>
          <p className="mt-6 text-center text-xs text-muted">הכניסה מאובטחת בקוד חד-פעמי. אין סיסמאות לזכור.</p>
        </div>
      </main>
    </div>
  )
}
