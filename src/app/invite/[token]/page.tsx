import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PasswordForm } from '@/components/settings/PasswordForm'
import { clientIp } from '@/server/log'
import { acceptInvitation, resolveInvitation } from '@/server/users/users'

export const dynamic = 'force-dynamic'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invitation = await resolveInvitation(token)

  // Unknown, expired, used and revoked all render the same page.
  if (!invitation) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-fg">ההזמנה אינה בתוקף</h1>
        <p className="mt-2 text-sm text-muted">
          ייתכן שפג תוקפה או שכבר נעשה בה שימוש. אפשר לבקש הזמנה חדשה ממנהל המערכת.
        </p>
      </Centered>
    )
  }

  async function accept(password: string) {
    'use server'
    const headerList = await headers()
    const result = await acceptInvitation({
      token,
      password,
      ip: clientIp(new Request('http://local', { headers: headerList })),
    })
    if (!result.ok) return { ok: false, message: result.message }
    redirect('/login?welcome=1')
  }

  return (
    <Centered>
      <PasswordForm
        action={accept}
        heading="ברוכים הבאים ל-XTRA SIGN"
        subheading={`הגדירו סיסמה עבור ${invitation.email}`}
        submitLabel="הגדרת סיסמה וכניסה"
      />
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center px-4 py-10">{children}</div>
}
