import { redirect } from 'next/navigation'
import { getSession } from '@/server/auth/session'
import { login } from '@/server/auth/login'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getSession()) redirect('/documents')
  const { error } = await searchParams

  async function submit(formData: FormData) {
    'use server'
    const result = await login(
      String(formData.get('email') ?? ''),
      String(formData.get('password') ?? ''),
    )
    if (!result.ok) redirect('/login?error=1')
    redirect('/documents')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-xl font-bold text-fg">כניסה ל-XTRA SIGN</h1>

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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-fg">
              סיסמה
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm"
            />
          </div>

          {error ? (
            // role="alert" so a screen reader announces it — a red border alone
            // is invisible to anyone not looking at the field.
            <p role="alert" className="text-sm text-danger">
              הפרטים שהוזנו אינם נכונים.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-2 min-h-11 rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            כניסה
          </button>
        </form>
      </div>
    </div>
  )
}
