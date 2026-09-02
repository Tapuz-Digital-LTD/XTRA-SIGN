'use client'

import type { Editor } from '@tiptap/react'
import {
  AlignHorizontalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Columns3,
  Merge,
  Rows3,
  Split,
  Table as TableIcon,
  Trash2,
} from 'lucide-react'
import { ToolButton, ToolDivider } from './toolbar'

/**
 * Table properties, the way a word processor offers them.
 *
 * Column width is set on the cell the cursor is in rather than through a
 * dialog, because the question a person actually has is "make *this* column
 * wider" — and the number they set is written into the document, so the PDF
 * matches what they laid out instead of re-flowing to fit.
 */

const TABLE_WIDTHS = [
  { value: '1', label: 'רוחב מלא' },
  { value: '0.75', label: '75%' },
  { value: '0.5', label: 'חצי' },
  { value: '', label: 'לפי תוכן' },
]

const COLUMN_WIDTHS = [80, 120, 160, 220, 300]

export function TablePanel({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-line bg-blue-50/60 px-3 py-1.5">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted">
        <TableIcon size={14} aria-hidden="true" />
        טבלה:
      </span>

      <label className="inline-flex items-center gap-1 text-xs text-muted">
        רוחב
        <select
          aria-label="רוחב הטבלה"
          defaultValue=""
          onChange={(event) => {
            const value = event.target.value
            editor.chain().focus().setTableWidth(value ? Number(value) : null).run()
          }}
          className="h-9 rounded-md border border-line bg-surface px-1.5 text-sm text-fg"
        >
          {TABLE_WIDTHS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="inline-flex items-center gap-1 text-xs text-muted">
        עמודה
        <select
          aria-label="רוחב העמודה"
          defaultValue=""
          onChange={(event) => {
            const width = Number(event.target.value)
            if (Number.isFinite(width) && width > 0) {
              // colwidth is ProseMirror's own column model, so the width is
              // shared by every cell in the column rather than one of them.
              editor.chain().focus().setCellAttribute('colwidth', [width]).run()
            }
            event.target.value = ''
          }}
          className="h-9 rounded-md border border-line bg-surface px-1.5 text-sm text-fg"
        >
          <option value="" disabled>
            רוחב
          </option>
          {COLUMN_WIDTHS.map((width) => (
            <option key={width} value={width}>
              {width}px
            </option>
          ))}
        </select>
      </label>

      <label
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-white"
        title="צבע רקע לתא"
      >
        <span className="sr-only">צבע רקע לתא</span>
        <input
          type="color"
          aria-label="צבע רקע לתא"
          onChange={(event) =>
            editor.chain().focus().setCellAttribute('backgroundColor', event.target.value).run()
          }
          className="size-5 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>

      <ToolDivider />

      <ToolButton
        Icon={ArrowUpToLine}
        label="הוספת שורה מעל"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      />
      <ToolButton
        Icon={ArrowDownToLine}
        label="הוספת שורה מתחת"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      />
      <ToolButton
        Icon={Columns3}
        label="הוספת עמודה"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      />

      <ToolDivider />

      <ToolButton
        Icon={Rows3}
        label="מחיקת שורה"
        onClick={() => editor.chain().focus().deleteRow().run()}
      />
      <ToolButton
        Icon={Columns3}
        label="מחיקת עמודה"
        onClick={() => editor.chain().focus().deleteColumn().run()}
      />

      <ToolDivider />

      <ToolButton
        Icon={Merge}
        label="מיזוג תאים"
        disabled={!editor.can().mergeCells()}
        onClick={() => editor.chain().focus().mergeCells().run()}
      />
      <ToolButton
        Icon={Split}
        label="פיצול תא"
        disabled={!editor.can().splitCell()}
        onClick={() => editor.chain().focus().splitCell().run()}
      />
      <ToolButton
        Icon={AlignHorizontalDistributeCenter}
        label="שורת כותרת"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      />

      <ToolDivider />

      <ToolButton
        Icon={Trash2}
        label="מחיקת הטבלה"
        onClick={() => editor.chain().focus().deleteTable().run()}
      />
    </div>
  )
}
