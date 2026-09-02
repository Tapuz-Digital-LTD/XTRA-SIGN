'use client'

import type { Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { findReplaceKey } from './find-replace'
import { ToolButton } from './toolbar'

/**
 * Word's Ctrl+F bar.
 *
 * The match counter reads from the editor's own plugin state rather than a copy
 * kept here, so it cannot disagree with what is highlighted on the page.
 */
export function FindReplaceBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [count, setCount] = useState({ current: 0, total: 0 })

  useEffect(() => {
    const read = () => {
      const found = findReplaceKey.getState(editor.state)
      setCount({ current: found?.matches.length ? found.current + 1 : 0, total: found?.matches.length ?? 0 })
    }
    editor.on('transaction', read)
    read()
    return () => {
      editor.off('transaction', read)
    }
  }, [editor])

  // Clearing the term on close removes the highlights with it.
  useEffect(() => () => { editor.commands.setSearchTerm('') }, [editor])

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-amber-50/70 px-3 py-2">
      <input
        autoFocus
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          editor.commands.setSearchTerm(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') editor.commands.goToMatch(e.shiftKey ? -1 : 1)
          if (e.key === 'Escape') onClose()
        }}
        placeholder="חיפוש"
        aria-label="חיפוש בטקסט"
        className="h-9 w-40 rounded-md border border-line bg-surface px-2 text-sm text-fg outline-none focus:border-brand"
      />
      <span className="min-w-16 text-xs tabular-nums text-muted">
        {count.total ? `${count.current} מתוך ${count.total}` : term ? 'לא נמצא' : ''}
      </span>
      <ToolButton Icon={ChevronUp} label="התאמה קודמת" onClick={() => editor.commands.goToMatch(-1)} />
      <ToolButton Icon={ChevronDown} label="התאמה הבאה" onClick={() => editor.commands.goToMatch(1)} />

      <input
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        placeholder="החלפה ב…"
        aria-label="טקסט להחלפה"
        className="h-9 w-40 rounded-md border border-line bg-surface px-2 text-sm text-fg outline-none focus:border-brand"
      />
      <ToolButton label="החלפה" text="החלפה" onClick={() => editor.commands.replaceCurrent(replacement)} />
      <ToolButton label="החלפת הכול" text="החלפת הכול" onClick={() => editor.commands.replaceAll(replacement)} />
      <ToolButton Icon={X} label="סגירת החיפוש" onClick={onClose} />
    </div>
  )
}
