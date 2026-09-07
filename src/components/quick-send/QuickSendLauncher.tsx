'use client'

import { Send } from 'lucide-react'
import { useState } from 'react'
import { QuickSendDialog } from './QuickSendDialog'

/** The home page's main button, and the dialog behind it. */
export function QuickSendLauncher({ templates }: { templates: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-20 items-center justify-center gap-3 rounded-xl bg-brand px-6 text-lg font-semibold text-white transition hover:opacity-90">
        <Send aria-hidden="true" className="size-5 -scale-x-100" />
        שלח מסמך לחתימה
      </button>
      {open ? <QuickSendDialog templates={templates} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
