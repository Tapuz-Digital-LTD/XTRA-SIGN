'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * "המשך חתימה" when a link or a code ran out: one big button that asks the
 * server for a fresh link on the same agreement and sends the phone code
 * again, then continues on the signing page. Signed already → the
 * thank-you page with its secure download.
 */
export function RenewSigning({ slug, formId, token, registrationId, maskedPhone }: { slug: string; formId: string; token?: string; registrationId?: string; maskedPhone?: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function renew() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/self-service/${formId}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, registrationId }) })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        setError(data?.error?.message ?? data?.message ?? 'לא הצלחנו לחדש את הקישור. נסו שוב בעוד רגע.')
        return
      }
      router.replace(data.kind === 'already_signed' ? `/${slug}/thanks/${data.token}` : `/${slug}/sign/${data.token}`)
    } catch {
      setError('לא הצלחנו לחדש את הקישור. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tj-flow">
      <section className="tj-card tj-center">
        <h1 className="tj-h1">ממשיכים לחתימה</h1>
        <p className="tj-lead">
          קבלו קוד{maskedPhone ? ` לטלפון ${maskedPhone}` : ' לטלפון שבו נרשמתם'} כדי להמשיך מהמקום שבו עצרתם. שום דבר לא אבד: אותו הסכם, בלי להירשם מחדש.
        </p>
        <button type="button" onClick={() => void renew()} disabled={busy} className="tj-primary" style={{ minHeight: 56, fontSize: '1.1rem', width: '100%', maxWidth: 420 }}>
          {busy ? 'שולחים קוד…' : 'שלחו לי קוד והמשיכו לחתימה'}
        </button>
        {error ? <p className="tj-alert" role="alert">{error}</p> : null}
      </section>
    </div>
  )
}
