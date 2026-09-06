'use client'

import { OTPInput, REGEXP_ONLY_DIGITS } from 'input-otp'
import { useEffect, useRef } from 'react'

/**
 * The one code input the whole product uses — login, signing, the campaign
 * page. Six big boxes over one real input, so paste, the numeric keypad
 * and the operating system's "fill code from Messages" all work; on
 * browsers that have it, WebOTP reads the SMS itself. None of that is
 * required: typing always works.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = true,
  length = 6,
  webOtp = true,
  id = 'otp',
  label = 'קוד אימות',
}: {
  value: string
  onChange: (code: string) => void
  onComplete?: (code: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  length?: number
  /** Ask the browser to read the SMS (WebOTP). Harmless where unsupported. */
  webOtp?: boolean
  id?: string
  label?: string
}) {
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  // WebOTP: progressive enhancement. Chrome on Android (with the SMS
  // formatted `@host #code`) resolves this with the code; everything else
  // rejects or never resolves, and nothing changes for the person.
  useEffect(() => {
    if (!webOtp || disabled) return
    if (typeof window === 'undefined' || !('OTPCredential' in window)) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3 * 60_000)
    const credentials = navigator.credentials as unknown as { get: (options: unknown) => Promise<{ code?: string } | null> }
    credentials
      .get({ otp: { transport: ['sms'] }, signal: controller.signal })
      .then((credential) => {
        const code = credential?.code?.replace(/\D/g, '').slice(0, length)
        if (code && code.length === length) {
          changeRef.current(code)
          completeRef.current?.(code)
        }
      })
      .catch(() => {})
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [webOtp, disabled, length])

  return (
    <div dir="ltr" className="flex justify-center">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <OTPInput
        id={id}
        value={value}
        onChange={onChange}
        onComplete={(code) => completeRef.current?.(code)}
        maxLength={length}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        containerClassName="group flex items-center gap-2 has-[:disabled]:opacity-60"
        aria-invalid={invalid || undefined}
        render={({ slots }) => (
          <>
            {slots.map((slot, i) => (
              <div
                key={i}
                aria-hidden="true"
                className={`relative flex h-14 w-11 items-center justify-center rounded-xl border-2 bg-surface text-2xl font-semibold tabular-nums text-fg transition-colors sm:h-16 sm:w-12 ${
                  invalid ? 'border-red-400' : slot.isActive ? 'border-brand shadow-[0_0_0_3px_rgba(29,78,216,0.15)]' : 'border-line'
                }`}
              >
                {slot.char ?? (slot.hasFakeCaret ? <span className="h-7 w-px animate-pulse bg-fg motion-reduce:animate-none" /> : null)}
              </div>
            ))}
          </>
        )}
      />
    </div>
  )
}
