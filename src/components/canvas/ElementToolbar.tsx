'use client'

import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic,
  Replace, Underline as UnderlineIcon,
} from 'lucide-react'
import type { CanvasElement, TextStyle } from '@/lib/canvas/model'
import { BINDING_LABELS } from '@/lib/canvas/bindings'

/**
 * The controls for whatever is selected.
 *
 * One strip that changes with the selection, rather than a wall of options that
 * are mostly irrelevant: a person editing a heading should not have to look
 * past table borders to find the font size.
 */

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48, 64]
const FONTS = ['Assistant', 'Arial', 'Times New Roman', 'Courier New', 'David']

export function ElementToolbar({
  element,
  onUpdate,
  onReplaceImage,
}: {
  element: CanvasElement
  onUpdate: (patch: Partial<CanvasElement>) => void
  onReplaceImage: () => void
}) {
  const patchStyle = (patch: Partial<TextStyle>) =>
    onUpdate({ style: { ...(element as { style?: TextStyle }).style, ...patch } } as never)

  const textStyle = (element as { style?: TextStyle }).style

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-white px-3 py-1.5">
      {element.kind === 'text' || element.kind === 'field' ? (
        <>
          <select aria-label="גופן" value={textStyle?.fontFamily ?? 'Assistant'}
            onChange={(event) => patchStyle({ fontFamily: event.target.value })}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg">
            {FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
          <select aria-label="גודל גופן" value={textStyle?.fontSize ?? 12}
            onChange={(event) => patchStyle({ fontSize: Number(event.target.value) })}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg">
            {FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>

          <Toggle label="מודגש" active={textStyle?.fontWeight === 'bold'} Icon={Bold}
            onClick={() => patchStyle({ fontWeight: textStyle?.fontWeight === 'bold' ? 'normal' : 'bold' })} />
          <Toggle label="נטוי" active={textStyle?.fontStyle === 'italic'} Icon={Italic}
            onClick={() => patchStyle({ fontStyle: textStyle?.fontStyle === 'italic' ? 'normal' : 'italic' })} />
          <Toggle label="קו תחתון" active={textStyle?.underline === true} Icon={UnderlineIcon}
            onClick={() => patchStyle({ underline: !textStyle?.underline })} />

          <Swatch label="צבע טקסט" value={textStyle?.color ?? '#0f172a'} onChange={(color) => patchStyle({ color })} />
          <Swatch label="צבע הדגשה" value={textStyle?.backgroundColor ?? '#ffffff'}
            onChange={(backgroundColor) => patchStyle({ backgroundColor })} />

          {([
            { mode: 'right', label: 'יישור לימין', Icon: AlignRight },
            { mode: 'center', label: 'מרכוז', Icon: AlignCenter },
            { mode: 'left', label: 'יישור לשמאל', Icon: AlignLeft },
            { mode: 'justify', label: 'לשני הצדדים', Icon: AlignJustify },
          ] as const).map(({ mode, label, Icon }) => (
            <Toggle key={mode} label={label} Icon={Icon} active={(textStyle?.align ?? 'right') === mode}
              onClick={() => patchStyle({ align: mode })} />
          ))}

          <select aria-label="כיוון טקסט" value={textStyle?.direction ?? 'rtl'}
            onChange={(event) => patchStyle({ direction: event.target.value as 'rtl' | 'ltr' })}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg">
            <option value="rtl">ימין לשמאל</option>
            <option value="ltr">שמאל לימין</option>
          </select>

          <label className="inline-flex items-center gap-1 text-xs text-muted">
            ריווח
            <input type="number" aria-label="ריווח שורות" step={0.1} min={0.8} max={3}
              value={textStyle?.lineHeight ?? 1.4}
              onChange={(event) => patchStyle({ lineHeight: Number(event.target.value) })}
              className="h-9 w-16 rounded-md border border-line bg-surface px-1 text-center text-sm text-fg" />
          </label>
        </>
      ) : null}

      {element.kind === 'image' ? (
        <>
          <button type="button" onClick={onReplaceImage}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line px-2 text-sm text-fg hover:border-brand">
            <Replace size={14} aria-hidden="true" /> החלפת תמונה
          </button>
          <select aria-label="התאמת תמונה" value={element.fit ?? 'cover'}
            onChange={(event) => onUpdate({ fit: event.target.value as 'cover' | 'contain' } as never)}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg">
            <option value="contain">התאמה מלאה</option>
            <option value="cover">מילוי המסגרת</option>
          </select>
          <Opacity element={element} onUpdate={onUpdate} />
        </>
      ) : null}

      {element.kind === 'rect' || element.kind === 'line' ? (
        <>
          <Swatch label="צבע מילוי" value={element.style?.fill ?? '#e2e8f0'}
            onChange={(fill) => onUpdate({ style: { ...element.style, fill } } as never)} />
          <Swatch label="צבע מסגרת" value={element.style?.borderColor ?? '#94a3b8'}
            onChange={(borderColor) => onUpdate({ style: { ...element.style, borderColor } } as never)} />
          <label className="inline-flex items-center gap-1 text-xs text-muted">
            עיגול
            <input type="number" aria-label="עיגול פינות" min={0} max={50} value={element.style?.borderRadius ?? 0}
              onChange={(event) => onUpdate({ style: { ...element.style, borderRadius: Number(event.target.value) } } as never)}
              className="h-9 w-16 rounded-md border border-line bg-surface px-1 text-center text-sm text-fg" />
          </label>
          <Opacity element={element} onUpdate={onUpdate} />
        </>
      ) : null}

      {/* Bindings, in the words a person uses rather than the key we store. */}
      {element.kind === 'text' || element.kind === 'field' ? (
        <label className="inline-flex items-center gap-1 text-xs text-muted">
          ממלא אוטומטית
          <select aria-label="מקור הנתונים"
            value={(element as { binding?: string }).binding ?? ''}
            onChange={(event) => onUpdate({ binding: event.target.value || undefined } as never)}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg">
            <option value="">ללא</option>
            {Object.entries(BINDING_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      ) : null}

      <span className="ms-auto text-xs tabular-nums text-muted">
        {Math.round(element.width)}×{Math.round(element.height)} מ״מ
      </span>
    </div>
  )
}

function Toggle({ label, active, Icon, onClick }: { label: string; active?: boolean; Icon: typeof Bold; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} title={label}
      className={`inline-flex size-9 items-center justify-center rounded-md transition ${
        active ? 'bg-brand text-white' : 'text-fg hover:bg-slate-100'
      }`}>
      <Icon size={15} aria-hidden="true" />
    </button>
  )
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100" title={label}>
      <span className="sr-only">{label}</span>
      <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}
        className="size-5 cursor-pointer border-0 bg-transparent p-0" />
    </label>
  )
}

function Opacity({ element, onUpdate }: { element: CanvasElement; onUpdate: (patch: Partial<CanvasElement>) => void }) {
  const style = (element as { style?: { opacity?: number } }).style
  return (
    <label className="inline-flex items-center gap-1 text-xs text-muted">
      שקיפות
      <input type="range" aria-label="שקיפות" min={0} max={1} step={0.05} value={style?.opacity ?? 1}
        onChange={(event) => onUpdate({ style: { ...style, opacity: Number(event.target.value) } } as never)}
        className="w-20" />
    </label>
  )
}
