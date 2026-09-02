'use client'

import DragHandle from '@tiptap/extension-drag-handle-react'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
  TextStyle,
} from '@tiptap/extension-text-style'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  Baseline,
  Highlighter,
  Indent as IndentIcon,
  Outdent,
  RemoveFormatting,
  Search,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  GripVertical,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SeparatorHorizontal,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { FIELD_TYPES, type FieldType } from '@/lib/fields'
import { useUnsavedGuard } from '@/components/editor/useUnsavedGuard'
import { FindReplace } from './find-replace'
import { FindReplaceBar } from './FindReplaceBar'
import { FIELD_META, XtraFieldNode } from './field-node'
import { Indent } from './indent'
import { PageBreakNode } from './page-break-node'
import { StyledTable, StyledTableCell, StyledTableHeader } from './table-styles'
import { TablePanel } from './TablePanel'
import { ResizableImage } from './resizable-image'
import { ToolButton, ToolDivider } from './toolbar'
import { PaginationPlus } from 'tiptap-pagination-plus'

/**
 * Writing a document and placing its signature fields, in one screen.
 *
 * The old flow made you write, generate a PDF, and only then discover where the
 * signature would land. Here the field is part of the text — "ולראיה באו הצדדים
 * על החתום: [חתימה]" — and where it sits in the sentence is where it sits on
 * the page. Saving renders the document once and measures each field's real
 * position from the PDF, so what was written and what gets signed cannot drift.
 *
 * The canvas is a real A4 page at real margins, and the text is styled with the
 * same point sizes the renderer uses. What is on screen is the page.
 */

/**
 * A4 at the margins `renderComposedDocument` prints with, in CSS pixels.
 *
 * 96px to the inch: 210mm is 794px wide, 297mm is 1123px tall, and a 12mm
 * margin is 45px. These are the numbers the page view is built from, so the
 * page breaks drawn on screen fall where the printed ones will.
 */
const A4 = { width: 794, height: 1123, margin: 45 } as const

const FONTS = ['Assistant', 'Arial', 'Times New Roman', 'Courier New', 'David']
const FONT_SIZES = ['10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '32pt']
const LINE_HEIGHTS = [
  { value: '1.15', label: 'צפוף' },
  { value: '1.5', label: 'רגיל' },
  { value: '1.8', label: 'מרווח' },
  { value: '2', label: 'כפול' },
]

export function UnifiedComposer({ companyId, companyName }: { companyId: string; companyName: string }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [finding, setFinding] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // Underline and Link already ship inside StarterKit v3; adding them again
      // registers the same extension twice.
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextStyle,
      Color,
      BackgroundColor,
      FontFamily,
      FontSize,
      LineHeight,
      Subscript,
      Superscript,
      Indent,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // The kit's own table nodes are replaced with ones that carry width,
      // background and alignment, so those survive into the PDF.
      TableKit.configure({
        table: false,
        tableCell: false,
        tableHeader: false,
      }),
      StyledTable.configure({ resizable: true }),
      StyledTableCell,
      StyledTableHeader,
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: 'כתבו כאן את תוכן המסמך…' }),
      CharacterCount,
      FindReplace,
      // Draws the real page boundaries. The document is written on pages, not
      // on an endless scroll that only becomes pages at the printer.
      PaginationPlus.configure({
        pageHeight: A4.height,
        pageWidth: A4.width,
        marginTop: A4.margin,
        marginBottom: A4.margin,
        marginLeft: A4.margin,
        marginRight: A4.margin,
        pageGap: 24,
        pageBreakBackground: '#f1f5f9',
        pageGapBorderSize: 1,
        contentMarginTop: 0,
        contentMarginBottom: 0,
      }),
      XtraFieldNode,
      PageBreakNode,
    ],
    content: '<h1>הסכם</h1><p></p>',
    editorProps: {
      attributes: {
        dir: 'rtl',
        class: 'xtra-doc outline-none',
      },
    },
    onUpdate: () => setDirty(true),
  })

  const { navigate, modal } = useUnsavedGuard(dirty)

  async function save() {
    if (!editor) return
    const name = title.trim()
    if (!name) {
      setError('יש להזין שם למסמך כדי להמשיך.')
      titleRef.current?.focus()
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
            ref={titleRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
              if (error) setError(null)
            }}
            placeholder="שם המסמך"
            aria-invalid={Boolean(error) && !title.trim()}
            className={`min-h-11 min-w-0 flex-1 rounded-lg border bg-bg px-3 text-sm font-medium text-fg outline-none sm:max-w-xs ${
              error && !title.trim() ? 'border-red-500' : 'border-line focus:border-brand'
            }`}
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

        {/* Beside the save button that produced it. The old placement was under
            the page canvas, so pressing save appeared to do nothing at all. */}
        {error ? (
          <p
            role="alert"
            className="flex items-center gap-2 border-t border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-0.5 border-t border-line px-3 py-1.5">
          <ToolButton Icon={Undo2} label="ביטול" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
          <ToolButton Icon={Redo2} label="שחזור" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
          <ToolDivider />

          <select
            aria-label="סגנון פסקה"
            value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
            onChange={(e) => {
              const value = e.target.value
              if (value === 'p') editor.chain().focus().setParagraph().run()
              else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
            }}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"
          >
            <option value="p">טקסט רגיל</option>
            <option value="h1">כותרת ראשית</option>
            <option value="h2">כותרת משנה</option>
            <option value="h3">כותרת קטנה</option>
          </select>
          <select
            aria-label="גופן"
            defaultValue=""
            onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"
          >
            <option value="" disabled>גופן</option>
            {FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
          <select
            aria-label="גודל גופן"
            defaultValue=""
            onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"
          >
            <option value="" disabled>גודל</option>
            {FONT_SIZES.map((size) => <option key={size} value={size}>{size.replace('pt', '')}</option>)}
          </select>
          <select
            aria-label="ריווח שורות"
            defaultValue=""
            onChange={(e) => editor.chain().focus().setLineHeight(e.target.value).run()}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"
          >
            <option value="" disabled>ריווח</option>
            {LINE_HEIGHTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <ToolDivider />

          <ToolButton Icon={Bold} label="מודגש" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolButton Icon={Italic} label="נטוי" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolButton Icon={UnderlineIcon} label="קו תחתון" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <ToolButton Icon={Strikethrough} label="קו חוצה" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <ToolButton Icon={SuperscriptIcon} label="כתב עילי" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
          <ToolButton Icon={SubscriptIcon} label="כתב תחתי" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
          <label className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100" title="צבע טקסט">
            <span className="sr-only">צבע טקסט</span>
            <Baseline size={16} aria-hidden="true" className="pointer-events-none absolute" />
            <input
              type="color"
              aria-label="צבע טקסט"
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
              className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0 opacity-0"
            />
          </label>
          <label className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100" title="צבע הדגשה">
            <span className="sr-only">צבע הדגשה</span>
            <Highlighter size={16} aria-hidden="true" className="pointer-events-none absolute" />
            <input
              type="color"
              aria-label="צבע הדגשה"
              onChange={(e) => editor.chain().focus().setBackgroundColor(e.target.value).run()}
              className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0 opacity-0"
            />
          </label>
          <ToolButton Icon={RemoveFormatting} label="ניקוי עיצוב" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
          <ToolDivider />

          {(
            [
              { align: 'right', label: 'יישור לימין', Icon: AlignRight },
              { align: 'center', label: 'מרכוז', Icon: AlignCenter },
              { align: 'left', label: 'יישור לשמאל', Icon: AlignLeft },
              { align: 'justify', label: 'יישור לשני הצדדים', Icon: AlignJustify },
            ] as const
          ).map(({ align, label, Icon }) => (
            <ToolButton key={align} Icon={Icon} label={label} active={editor.isActive({ textAlign: align })} onClick={() => editor.chain().focus().setTextAlign(align).run()} />
          ))}
          <ToolDivider />

          <ToolButton Icon={List} label="רשימה" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolButton Icon={ListOrdered} label="רשימה ממוספרת" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <ToolButton Icon={Quote} label="ציטוט" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <ToolButton Icon={IndentIcon} label="הגדלת כניסה" onClick={() => editor.chain().focus().indent().run()} />
          <ToolButton Icon={Outdent} label="הקטנת כניסה" onClick={() => editor.chain().focus().outdent().run()} />
          <ToolDivider />

          <ToolButton Icon={TableIcon} label="הוספת טבלה" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          <ToolButton Icon={ImageIcon} label="הוספת תמונה" onClick={addImage} />
          <ToolButton Icon={Minus} label="קו מפריד" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
          <ToolButton Icon={SeparatorHorizontal} label="מעבר עמוד" onClick={() => editor.chain().focus().setPageBreak().run()} />
          <ToolDivider />
          <ToolButton Icon={Search} label="חיפוש והחלפה" active={finding} onClick={() => setFinding((open) => !open)} />
        </div>

        {finding ? <FindReplaceBar editor={editor} onClose={() => setFinding(false)} /> : null}

        {editor.isActive('table') ? <TablePanel editor={editor} /> : null}

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

      {/* Formatting where the eye already is, rather than back up at the toolbar. */}
      <BubbleMenu editor={editor} className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow)]">
        <ToolButton Icon={Bold} label="מודגש" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton Icon={Italic} label="נטוי" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton Icon={UnderlineIcon} label="קו תחתון" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolDivider />
        <ToolButton Icon={AlignRight} label="יישור לימין" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
        <ToolButton Icon={AlignCenter} label="מרכוז" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
      </BubbleMenu>

      {/* Grab any block by its grip and move it, without cut and paste. */}
      <DragHandle editor={editor}>
        <div className="xtra-drag-handle" title="גררו כדי להזיז" aria-hidden="true">
          <GripVertical size={16} />
        </div>
      </DragHandle>

      <main className="flex-1 overflow-y-auto px-3 py-6">
        {/* PaginationPlus paints the pages, their margins and the gaps between
            them, so this wrapper only sets the paper width and its shadow. */}
        <div
          className="mx-auto max-w-full bg-white shadow-[0_1px_3px_rgb(0_0_0_/_0.12),0_8px_24px_rgb(0_0_0_/_0.08)]"
          style={{ width: A4.width }}
        >
          <EditorContent editor={editor} />
        </div>

        <p className="mx-auto mt-3 max-w-[794px] text-start text-xs text-muted tabular-nums">
          {editor.storage.characterCount.words()} מילים · {editor.storage.characterCount.characters()} תווים
        </p>
      </main>
    </div>
  )
}
