import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/LoginForm'
import { getSession } from '@/server/auth/session'

export default async function LoginPage() {
  if (await getSession()) redirect('/documents')

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-xl font-bold text-fg">
          כניסה ל-<span dir="ltr">XTRA SIGN</span>
        </h1>
        <LoginForm />
      </div>
    </div>
  )
}
