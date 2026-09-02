'use client'

import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FIELD_TYPES, type FieldType } from '@/lib/fields'
import { useUnsavedGuard } from '@/components/editor/useUnsavedGuard'
import { FIELD_META, XtraFieldNode } from './field-node'
import { PageBreakNode } from './page-break-node'

/**
 * Writing a document and placing its signature fields, in one screen.
 *
 * The old flow made you write, generate a PDF, and only then discover where the
 * signature would land. Here the field is part of the text — "ולראיה באו הצדדים
 * על החתום: [חתימה]" — and where it sits in the sentence is where it sits on
 * the page. Saving renders the document once and measures each field's real
 * position from the PDF, so what was written and what gets signed cannot drift.
 */
/** A toolbar button. Defined once, not rebuilt on every render. */
function Btn({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded px-2 text-sm transition ${
        active ? 'bg-brand text-white' : 'text-fg hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

export function UnifiedComposer({ companyId, companyName }: { companyId: string; companyName: string }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ inline: false, allowBase64: true }),
      XtraFieldNode,
      PageBreakNode,
    ],
    content: '<h1>הסכם</h1><p>כתבו כאן את תוכן המסמך.</p>',
    editorProps: {
      attributes: {
        dir: 'rtl',
        class: 'xtra-doc min-h-[60vh] outline-none',
      },
    },
    onUpdate: () => setDirty(true),
  })

  const { navigate, modal } = useUnsavedGuard(dirty)

  async function save() {
    if (!editor) return
    const name = title.trim()
    if (!name) {
      setError('יש להזין שם למסמך.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/documents/composer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name, html: editor.getHTML(), companyId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השמירה נכשלה.')
        return
      }
      setDirty(false)
      router.push(`/documents/${data.agreementId}`)
    } catch {
      setError('השמירה נכשלה. נסו שוב.')
    } finally {
      setSaving(false)
    }
  }

  function addImage() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file || !editor) return
      if (file.size > 2 * 1024 * 1024) {
        setError('התמונה גדולה מדי (עד 2MB).')
        return
      }
      const reader = new FileReader()
      reader.onload = () => editor.chain().focus().setImage({ src: String(reader.result) }).run()
      reader.readAsDataURL(file)
    }
    input.click()
  }

  if (!editor) return <p className="p-6 text-sm text-muted">טוען עורך…</p>

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {modal}

      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => navigate('/documents/new?company=' + companyId)}
            className="min-h-11 rounded-lg px-2 text-sm text-muted hover:text-fg"
          >
            → חזרה
          </button>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
            placeholder="שם המסמך"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm font-medium text-fg outline-none focus:border-brand sm:max-w-xs"
          />
          <span className="hidden text-xs text-muted sm:inline">עבור {companyName}</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="ms-auto inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'שומר…' : 'שמירה והמשך'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-0.5 border-t border-line px-3 py-1.5">
          <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} label="מודגש"><b>B</b></Btn>
          <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} label="נטוי"><i>I</i></Btn>
          <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} label="קו תחתון"><u>U</u></Btn>
          <span className="mx-1 h-5 w-px bg-line" />
          {([1, 2, 3] as const).map((level) => (
            <Btn key={level} onClick={() => editor.chain().focus().toggleHeading({ level }).run()} active={editor.isActive('heading', { level })} label={`כותרת ${level}`}>H{level}</Btn>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} label="רשימה">•</Btn>
          <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} label="רשימה ממוספרת">1.</Btn>
          <span className="mx-1 h-5 w-px bg-line" />
          {(['right', 'center', 'left', 'justify'] as const).map((align) => (
            <Btn key={align} onClick={() => editor.chain().focus().setTextAlign(align).run()} active={editor.isActive({ textAlign: align })} label={`יישור ${align}`}>
              {align === 'right' ? '⇥' : align === 'center' ? '≡' : align === 'left' ? '⇤' : '☰'}
            </Btn>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <select
            aria-label="גופן"
            onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
            className="min-h-9 rounded border border-line bg-surface px-1 text-sm"
          >
            <option value="">גופן</option>
            {['Assistant', 'Arial', 'Times New Roman'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <input
            type="color"
            aria-label="צבע טקסט"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="h-9 w-9 cursor-pointer rounded border border-line bg-surface p-0.5"
          />
          <span className="mx-1 h-5 w-px bg-line" />
          <Btn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="טבלה">▦</Btn>
          <Btn onClick={addImage} label="תמונה">🖼</Btn>
          <Btn onClick={() => editor.chain().focus().setPageBreak().run()} label="מעבר עמוד">⤓</Btn>
          <span className="mx-1 h-5 w-px bg-line" />
          <Btn onClick={() => editor.chain().focus().undo().run()} label="ביטול">↶</Btn>
          <Btn onClick={() => editor.chain().focus().redo().run()} label="שחזור">↷</Btn>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-line bg-bg px-3 py-1.5">
          <span className="me-1 text-xs font-medium text-muted">שדות לחתימה:</span>
          {FIELD_TYPES.map((field) => (
            <button
              key={field.type}
              type="button"
              onClick={() => editor.chain().focus().insertXtraField({ fieldType: field.type as FieldType }).run()}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs text-fg transition hover:border-brand"
            >
              <span aria-hidden="true">{FIELD_META[field.type as FieldType]?.icon}</span>
              {field.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 py-6">
        <div className="mx-auto max-w-[820px] rounded-[var(--radius-card)] border border-line bg-white p-[15mm] shadow-[var(--shadow)]">
          <EditorContent editor={editor} />
        </div>
        {error ? (
          <p role="alert" className="mx-auto mt-3 max-w-[820px] rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  )
}
