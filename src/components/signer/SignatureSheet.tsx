'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The signature sheet.
 *
 * Two ways to sign — draw or type — and one consent checkbox. Nothing else:
 * the spec asks for a screen someone can complete with a thumb, and every extra
 * option here is a decision between them and a signed agreement.
 */
export function SignatureSheet({
  signerName,
  busy,
  onCancel,
  onConfirm,
}: {
  signerName: string
  busy: boolean
  onCancel: () => void
  onConfirm: (dataUrl: string, method: 'drawn' | 'typed', consent: string) => void
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [typed, setTyped] = useState(signerName)
  const [consented, setConsented] = useState(false)
  const [hasDrawing, setHasDrawing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  // The exact wording is configurable and must be reviewed by a lawyer before
  // production; nothing here claims the signature is certified or qualified.
  const consentText =
    'אני מאשר/ת שקראתי את המסמך ושחתימתי ניתנת על ידי מרצוני.'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Backing store at device resolution: a signature drawn on a phone and
    // stamped into a PDF is otherwise a blurry line.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [mode])

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const p = point(event)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    event.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = point(event)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    setHasDrawing(true)
  }

  function stop() {
    drawing.current = false
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawing(false)
  }

  /** Renders the typed name onto a canvas so both modes produce one PNG. */
  function typedToPng(): string {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 260
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '96px "Assistant", sans-serif'
    ctx.fillText(typed.trim(), canvas.width / 2, canvas.height / 2)
    return canvas.toDataURL('image/png')
  }

  const ready = consented && (mode === 'draw' ? hasDrawing : typed.trim().length > 0)

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="החתימה שלך">
      <div className="w-full max-w-lg rounded-t-2xl bg-surface p-5 pb-8">
        <h2 className="text-base font-semibold text-fg">החתימה שלך</h2>

        <div className="mt-4 flex gap-2">
          {(['draw', 'type'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`min-h-11 flex-1 rounded-lg border text-sm ${
                mode === m
                  ? 'border-[var(--color-accent)] bg-blue-50 font-medium text-fg'
                  : 'border-line bg-white text-muted'
              }`}
            >
              {m === 'draw' ? 'ציור חתימה' : 'הקלדת שם'}
            </button>
          ))}
        </div>

        {mode === 'draw' ? (
          <div className="mt-4">
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
              // touch-none stops the browser scrolling the page while a finger
              // is drawing.
              className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-line bg-white"
              aria-label="שטח חתימה"
            />
            <button type="button" onClick={clear} className="mt-2 min-h-11 text-sm text-muted">
              ניקוי
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <label htmlFor="typed" className="text-xs font-medium text-fg">
              שם מלא
            </label>
            <input
              id="typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-lg border border-line bg-white px-3 text-lg"
            />
          </div>
        )}

        <label className="mt-5 flex items-start gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>{consentText}</span>
        </label>

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-muted">
          לאחר האישור המסמך ייחתם ולא יהיה ניתן לערוך אותו.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-lg border border-line bg-white text-sm text-fg"
          >
            ביטול
          </button>
          <button
            type="button"
            disabled={!ready || busy || confirming}
            onClick={() => {
              setConfirming(true)
              const dataUrl =
                mode === 'draw' ? (canvasRef.current?.toDataURL('image/png') ?? '') : typedToPng()
              onConfirm(dataUrl, mode === 'draw' ? 'drawn' : 'typed', consentText)
            }}
            className="min-h-12 flex-[2] rounded-lg bg-brand text-sm font-medium text-white disabled:opacity-50"
          >
            {busy || confirming ? 'חותם…' : 'אישור וחתימה'}
          </button>
        </div>
      </div>
    </div>
  )
}
