'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A drawing surface for a signature: a finger on a phone, a mouse on a
 * desktop. Emits a PNG data URL after every stroke, null when cleared, so
 * the page around it always knows whether there is a signature to send.
 */
export function SignaturePad({
  onChange,
  className,
  label = 'שטח חתימה',
  clearLabel = 'ניקוי',
}: {
  onChange: (dataUrl: string | null) => void
  className?: string
  label?: string
  clearLabel?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasDrawing, setHasDrawing] = useState(false)
  // Mirrors the state for the resize observer, which must not re-run the
  // effect (re-running it would reset the canvas mid-stroke).
  const hasDrawingRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const prepare = () => {
      // Backing store at device resolution: a signature drawn on a phone and
      // stamped into a PDF is otherwise a blurry line. Resizing clears the
      // canvas, so it only happens while there is nothing on it.
      const ratio = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0c3257'
    }
    prepare()
    const observer = new ResizeObserver(() => {
      if (!hasDrawingRef.current) prepare()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

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
    // A tap leaves a dot, not nothing.
    ctx.lineTo(p.x + 0.1, p.y + 0.1)
    ctx.stroke()
    hasDrawingRef.current = true
    setHasDrawing(true)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    event.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = point(event)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function stop() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasDrawingRef.current = false
    setHasDrawing(false)
    onChange(null)
  }

  return (
    <div className={className}>
      <div className="tj-pad-frame">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
          onPointerLeave={stop}
          className="tj-pad"
          aria-label={label}
          role="img"
        />
        {!hasDrawing ? (
          <span className="tj-pad-hint" aria-hidden="true">
            חתמו כאן באצבע או בעכבר
          </span>
        ) : null}
        <span className="tj-pad-line" aria-hidden="true" />
      </div>
      <button type="button" onClick={clear} className="tj-pad-clear" disabled={!hasDrawing}>
        {clearLabel}
      </button>
    </div>
  )
}
