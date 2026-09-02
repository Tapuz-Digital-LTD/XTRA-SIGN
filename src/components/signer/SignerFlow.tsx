'use client'

import { useMemo, useState } from 'react'
import type { PageGeometry, PlacedField } from '@/lib/fields'
import { OtpStep } from './OtpStep'
import { SignatureSheet } from './SignatureSheet'
import { SignerDocument } from './SignerDocument'

/**
 * The signer's whole journey, mobile-first.
 *
 * intro → verify → start → sign (guided) → done. Someone standing in a car park
 * on a phone is led through every action one button at a time and never has to
 * decide where to go next.
 */
type Stage = 'intro' | 'verify' | 'start' | 'document' | 'done'

export function SignerFlow({
  token,
  title,
  signerName,
  maskedPhone,
  hasPhone,
  verified,
  pages,
  fields,
}: {
  token: string
  title: string
  signerName: string
  maskedPhone: string | null
  hasPhone: boolean
  verified: boolean
  pages: PageGeometry[]
  fields: PlacedField[]
}) {
  const [stage, setStage] = useState<Stage>(verified ? 'start' : 'intro')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.value ?? ''])),
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const [signature, setSignature] = useState<{ dataUrl: string; method: 'drawn' | 'typed'; consent: string } | null>(null)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // How many actions the signer has: their required fields, plus every signature.
  const actionCount = useMemo(
    () =>
      fields.filter((f) => f.ownedBy === 'signer' && (f.type === 'signature' || f.required)).length,
    [fields],
  )

  async function finish() {
    if (!signature) {
      setError('נדרשת חתימה כדי לסיים.')
      return
    }
    setSigning(true)
    setError(null)
    try {
      // Values first: the completion endpoint refuses if a required field is
      // still empty, and this is the write that carries them.
      const save = await fetch(`/api/sign/${token}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      if (!save.ok) {
        const data = await save.json().catch(() => null)
        setError(data?.error?.message ?? 'לא הצלחנו לשמור את הפרטים.')
        return
      }

      const response = await fetch(`/api/sign/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: signature.dataUrl, method: signature.method, consent: signature.consent }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'החתימה נכשלה. נסו שוב.')
        return
      }
      setStage('done')
    } catch {
      setError('החתימה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setSigning(false)
    }
  }

  if (stage === 'done') {
    return (
      <Centered>
        <p className="text-4xl" aria-hidden="true">
          ✓
        </p>
        <h1 className="mt-3 text-xl font-bold text-fg">החתימה הושלמה בהצלחה</h1>
        <p className="mt-2 text-sm text-muted">העתק של המסמך החתום נשלח אליך.</p>
        <a
          href={`/api/sign/${token}/download`}
          className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-brand px-6 text-sm font-medium text-white"
        >
          הורדת המסמך
        </a>
      </Centered>
    )
  }

  if (stage === 'intro') {
    return (
      <Centered>
        <p className="text-sm font-bold tracking-tight text-fg">
          XTRA <span className="text-brand">SIGN</span>
        </p>
        <h1 className="mt-6 text-xl font-bold text-fg">שלום {signerName},</h1>
        <p className="mt-1 text-lg text-fg">מחכה לך מסמך לחתימה</p>
        <p className="mt-3 text-sm text-muted">{title}</p>
        <button
          type="button"
          onClick={() => setStage(hasPhone ? 'verify' : 'start')}
          className="mt-8 min-h-12 w-full rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          לצפייה וחתימה
        </button>
      </Centered>
    )
  }

  if (stage === 'verify') {
    return (
      <Centered>
        <OtpStep token={token} maskedPhone={maskedPhone} onVerified={() => setStage('start')} />
      </Centered>
    )
  }

  if (stage === 'start') {
    return (
      <Centered>
        <p className="text-2xl" aria-hidden="true">
          ✍
        </p>
        <h1 className="mt-3 text-xl font-bold text-fg">אפשר להתחיל</h1>
        <p className="mt-2 text-sm text-muted">
          {actionCount > 0
            ? `נדרשות ${actionCount} פעולות. נוביל אותך ביניהן אחת-אחת — לא צריך לחפש כלום.`
            : 'נותר רק לחתום. נוביל אותך לשם.'}
        </p>
        <button
          type="button"
          onClick={() => setStage('document')}
          className="mt-8 min-h-12 w-full rounded-lg bg-brand text-base font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          התחלת חתימה
        </button>
      </Centered>
    )
  }

  return (
    <>
      <SignerDocument
        token={token}
        title={title}
        pages={pages}
        fields={fields}
        values={values}
        signatureCaptured={Boolean(signature)}
        error={error}
        busy={signing}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
        onOpenSignature={() => setSheetOpen(true)}
        onFinish={finish}
      />
      {sheetOpen ? (
        <SignatureSheet
          signerName={signerName}
          busy={false}
          onCancel={() => setSheetOpen(false)}
          onConfirm={async (dataUrl, method, consent) => {
            // Capture only — the actual completion happens once from the finish
            // button, so the same signature is applied to every signature spot.
            setSignature({ dataUrl, method, consent })
            setSheetOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        {children}
      </div>
    </div>
  )
}
