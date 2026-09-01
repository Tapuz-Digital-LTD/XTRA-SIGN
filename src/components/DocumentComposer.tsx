'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

/**
 * Writing a document inside the system.
 *
 * A title and a text box. Three conventions — `#` for a heading, `-` for a
 * list item, `---` for a page break — and a live preview beside the text so
 * nobody has to guess what they produce. The server turns the same text into
 * the PDF, so what the preview shows is what the signer gets.
 */

const EXAMPLE = `# הצדדים
הסכם זה נערך בין החברה לבין הספק.

# תנאים
- הספק יספק את השירותים המפורטים בנספח א'.
- התשלום יבוצע תוך 30 יום מקבלת חשבונית.

# חתימות
הצדדים מאשרים את האמור לעיל.`

type Line =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'break' }

/** Mirrors the server's parser closely enough for a faithful preview. */
function previewLines(text: string): Line[] {
  const out: Line[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) out.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (/^-{3,}$/.test(line)) {
      flush()
      out.push({ kind: 'break' })
    } else if (/^#+\s+/.test(line)) {
      flush()
      out.push({ kind: 'heading', text: line.replace(/^#+\s+/, '') })
    } else if (/^[-*•]\s+/.test(line)) {
      flush()
      out.push({ kind: 'bullet', text: line.replace(/^[-*•]\s+/, '') })
    } else {
      paragraph.push(line)
    }
  }
  flush()
  return out
}

export function DocumentComposer() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lines = useMemo(() => previewLines(text), [text])
  const canCreate = title.trim().length > 0 && lines.some((l) => l.kind !== 'break') && !busy

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/documents/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'יצירת המסמך נכשלה.')
        return
      }
      // Straight into the field editor: the document exists, now place the signature.
      router.push(`/documents/${data.agreementId}/edit`)
    } catch {
      setError('יצירת המסמך נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="compose-title" className="text-xs font-medium text-fg">
            שם המסמך
          </label>
          <input
            id="compose-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="למשל: הסכם ספק — אטרקציות ישראל"
            className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="compose-text" className="text-xs font-medium text-fg">
              תוכן המסמך
            </label>
            {text.trim() ? null : (
              <button
                type="button"
                onClick={() => setText(EXAMPLE)}
                className="text-xs text-muted underline-offset-4 hover:text-fg hover:underline"
              >
                הכנסת דוגמה
              </button>
            )}
          </div>
          <textarea
            id="compose-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            maxLength={20000}
            placeholder={'# כותרת\nפסקה של טקסט.\n- פריט ברשימה\n---  (מעבר עמוד)'}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm leading-relaxed"
          />
          <p className="text-xs text-muted">
            שורה שמתחילה ב-<code dir="ltr">#</code> היא כותרת, ב-<code dir="ltr">-</code>{' '}
            פריט ברשימה, ו-<code dir="ltr">---</code> בשורה נפרדת מתחיל עמוד חדש. שורה ריקה
            מפרידה בין פסקאות. את החתימה והשדות למילוי מוסיפים בשלב הבא, על גבי העמוד.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canCreate}
          onClick={create}
          className="min-h-12 rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {busy ? 'יוצר את המסמך…' : 'יצירת המסמך והמשך לשדות'}
        </button>
      </div>

      <aside aria-label="תצוגה מקדימה" className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 text-xs font-medium text-muted">תצוגה מקדימה</p>
        <div className="min-h-64 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow)]">
          {title.trim() ? (
            <h2 className="border-b border-line pb-2 text-lg font-bold text-fg">{title}</h2>
          ) : (
            <p className="text-sm text-muted">שם המסמך יופיע כאן</p>
          )}
          <div className="mt-3 flex flex-col gap-2 text-sm text-fg">
            {lines.map((line, index) => {
              switch (line.kind) {
                case 'heading':
                  return (
                    <p key={index} className="mt-2 font-semibold">
                      {line.text}
                    </p>
                  )
                case 'bullet':
                  return (
                    <p key={index} className="ps-4">
                      • {line.text}
                    </p>
                  )
                case 'break':
                  return (
                    <p key={index} className="my-2 border-t border-dashed border-line pt-1 text-center text-[10px] text-muted">
                      עמוד חדש
                    </p>
                  )
                default:
                  return <p key={index}>{line.text}</p>
              }
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}
