import { JoinForm } from '@/components/projects/JoinForm'
import { getPublicLanding } from '@/server/projects/landing'

export const dynamic = 'force-dynamic'

/**
 * A project's public joining page. No login, no navigation, nothing about the
 * rest of the system — just the form the project chose to show.
 */
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const landing = await getPublicLanding(slug)

  if (!landing) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-lg font-semibold text-fg">הטופס אינו זמין</p>
          <p className="mt-2 text-sm text-muted">ייתכן שהקישור שגוי או שהטופס נסגר. אפשר לפנות למי ששלח לכם אותו.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-bg px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        {landing.config.imageUrl ? (
          // Whatever the project uploaded; dimensions are unknown, so a plain img.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={landing.config.imageUrl} alt="" className="mx-auto mb-6 max-h-24 w-auto" />
        ) : null}
        <h1 className="text-center text-2xl font-bold tracking-tight text-fg">{landing.config.title}</h1>
        {landing.config.description ? (
          <p className="mt-2 whitespace-pre-line text-center text-sm text-muted">{landing.config.description}</p>
        ) : null}

        <div className="mt-6">
          <JoinForm slug={slug} config={landing.config} />
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          <span dir="ltr">XTRA Sign</span> · טופס מאובטח
        </p>
      </div>
    </main>
  )
}
