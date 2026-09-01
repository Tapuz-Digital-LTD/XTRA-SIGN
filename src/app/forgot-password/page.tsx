import Link from 'next/link'
import { redirect } from 'next/navigation'
import { clientIp } from '@/server/log'
import { headers } from 'next/headers'
import { requestPasswordReset } from '@/server/users/users'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>
}) {
  const { sent } = await searchParams

  async function submit(formData: FormData) {
    'use server'
    const headerList = await headers()
    await requestPasswordReset({
      email: String(formData.get('email') ?? ''),
      ip: clientIp(new Request('http://local', { headers: headerList })),
    })
    // Always the same outcome, whether or not the address exists.
    redirect('/forgot-password?sent=1')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-xl font-bold text-fg">איפוס סיסמה</h1>

        {sent ? (
          <div role="status" className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 text-center text-sm text-fg">
            אם הכתובת קיימת במערכת, נשלח אליה קישור לאיפוס סיסמה.
            <br />
            <span className="text-muted">הקישור בתוקף לשעה אחת.</span>
          </div>
        ) : (
          <form action={submit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-fg">
                אימייל
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                dir="ltr"
                className="min-h-11 rounded-lg border border-line bg-surface px-3 text-start text-sm"
              />
            </div>
            <button
              type="submit"
              className="mt-2 min-h-11 rounded-lg bg-brand text-sm font-medium text-white"
            >
              שליחת קישור
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-muted underline-offset-4 hover:text-fg hover:underline">
            חזרה לכניסה
          </Link>
        </p>
      </div>
    </div>
  )
}
