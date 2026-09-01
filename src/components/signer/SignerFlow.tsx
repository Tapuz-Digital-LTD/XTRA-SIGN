'use client'

import { useMemo, useState } from 'react'
import type { PageGeometry, PlacedField } from '@/lib/fields'
import { OtpStep } from './OtpStep'
import { SignatureSheet } from './SignatureSheet'
import { SignerDocument } from './SignerDocument'

/**
 * The signer's whole journey, mobile-first.
 *
 * Four states, no navigation: intro, verify, fill and sign, done. Someone
 * standing in a car park on a phone should never have to decide where to go
 * next — the next action is always the one button at the bottom.
 */
type Stage = 'intro' | 'verify' | 'document' | 'done'

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
  // A verified session skips straight to the document, which is what makes a
  // refresh or a reopened link painless.
  const [stage, setStage] = useState<Stage>(verified ? 'document' : 'intro')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.value ?? ''])),
  )
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fields the signer has to deal with. Ours are already filled and shown as
  // context, not as work.
  const signerFields = useMemo(() => fields.filter((f) => f.ownedBy === 'signer'), [fields])
  const remaining = signerFields.filter(
    (f) => f.required && f.type !== 'signature' && !values[f.id]?.trim(),
  )

  if (stage === 'done') {
    return (
      <Centered>
        <p className="text-4xl" aria-hidden="true">
          ✓
        </p>
        <h1 className="mt-3 text-xl font-bold text-fg">המסמך נחתם בהצלחה</h1>
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
          onClick={() => setStage(hasPhone ? 'verify' : 'document')}
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
        <OtpStep
          token={token}
          maskedPhone={maskedPhone}
          onVerified={() => setStage('document')}
        />
      </Centered>
    )
  }

  return (
    <SignerDocument
      token={token}
      title={title}
      pages={pages}
      fields={fields}
      values={values}
      remaining={remaining.length}
      error={error}
      busy={signing}
      onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
      renderSignature={(onDone) => (
        <SignatureSheet
          signerName={signerName}
          busy={signing}
          onCancel={() => onDone(false)}
          onConfirm={async (dataUrl, method, consent) => {
            setSigning(true)
            setError(null)
            try {
              // Values first: the completion endpoint refuses if a required
              // field is still empty, and this is the one write that carries them.
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
                body: JSON.stringify({ signature: dataUrl, method, consent }),
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
              onDone(true)
            }
          }}
        />
      )}
    />
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
