'use client'

import { useState } from 'react'

/** Copies a value and says so for a moment. */
export function CopyButton({ text, label = 'העתק', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          window.prompt('העתיקו:', text)
        }
      }}
      className={className ?? 'inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand'}
    >
      {copied ? 'הועתק' : label}
    </button>
  )
}
