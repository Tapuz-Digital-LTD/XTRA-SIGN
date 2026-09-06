'use client'

import { track } from './track'
/**
 * The thank-you screen: a drawn checkmark, a little confetti in the
 * campaign's colours, the download. CSS only, and still with
 * prefers-reduced-motion (everything just appears).
 */

const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 53) % 100}%`,
  delay: `${(i % 6) * 0.18}s`,
  duration: `${2.6 + (i % 4) * 0.5}s`,
  color: ['#ff95c5', '#45b2ed', '#ffffff', '#ffd166'][i % 4],
  size: 6 + (i % 3) * 3,
  round: i % 3 === 0,
}))

export function ThanksView({
  title,
  text,
  projectName,
  signerName,
  downloadHref,
  emailed,
  email,
  formId,
  token,
}: {
  title: string
  text: string
  projectName: string
  signerName: string
  downloadHref: string
  formId: string
  token: string
  emailed: boolean
  email: string | null
}) {
  return (
    <div className="tj-flow">
      <section className="tj-card tj-center tj-thanks">
        <div className="tj-confetti" aria-hidden="true">
          {CONFETTI.map((piece, i) => (
            <span
              key={i}
              style={{
                left: piece.left,
                animationDelay: piece.delay,
                animationDuration: piece.duration,
                background: piece.color,
                width: piece.size,
                height: piece.round ? piece.size : piece.size * 1.8,
                borderRadius: piece.round ? '50%' : 2,
              }}
            />
          ))}
        </div>

        <svg className="tj-checkmark" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="tj-checkmark-circle" cx="60" cy="60" r="52" />
          <path className="tj-checkmark-path" d="M36 62 L53 79 L86 44" />
        </svg>

        <h1 className="tj-h1">{title}</h1>
        <p className="tj-lead">
          {signerName}, תודה שהצטרפתם ל{projectName}. ההסכם נחתם ונשמר.
        </p>
        {text ? <p className="tj-lead">{text}</p> : null}

        <a href={downloadHref} onClick={() => track(formId, 'signed_document_downloaded', { token })} className="tj-primary tj-inline-link">
          הורדת ההסכם החתום
        </a>

        <p className="tj-hint tj-thanks-note">
          {emailed && email
            ? `קישור להורדת ההסכם החתום נשלח גם לכתובת ${email}.`
            : 'שמרו את ההודעה שקיבלתם בנייד — הקישור שבה מוביל לעמוד הזה.'}
        </p>
      </section>
    </div>
  )
}
