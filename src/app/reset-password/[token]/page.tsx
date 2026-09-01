import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PasswordForm } from '@/components/settings/PasswordForm'
import { clientIp } from '@/server/log'
import { completePasswordReset } from '@/server/users/users'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  async function reset(password: string) {
    'use server'
    const headerList = await headers()
    const result = await completePasswordReset({
      token,
      password,
      ip: clientIp(new Request('http://local', { headers: headerList })),
    })
    if (!result.ok) return { ok: false, message: result.message }
    redirect('/login?reset=1')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <PasswordForm
        action={reset}
        heading="בחירת סיסמה חדשה"
        submitLabel="שמירת סיסמה"
      />
    </div>
  )
}
