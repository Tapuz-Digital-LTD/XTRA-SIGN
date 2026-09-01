'use client'

import { FIELD_TYPES, type FieldType } from '@/lib/fields'

/**
 * The field palette.
 *
 * Nine types, one list, no categories. Each entry is both draggable (desktop)
 * and clickable (touch, where HTML5 drag does not exist) — the same field
 * either way, so nobody has to discover which gesture this build supports.
 */
export function FieldToolbar({
  onAdd,
  saveState,
  saveError,
}: {
  onAdd: (type: FieldType) => void
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
}) {
  return (
    /*
      On a phone the palette is a horizontal strip, not a grid: nine stacked
      buttons pushed the document itself below the fold, so the user scrolled
      past the whole toolbar to see the thing being edited. On a wide screen
      there is room for the vertical list beside the page.
    */
    <div className="w-full shrink-0 lg:w-52 lg:self-start">
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3 lg:sticky lg:top-4">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold text-fg">שדות</h2>
          <p className="text-xs text-muted lg:hidden">גררו או לחצו</p>
        </div>
        <p className="mt-0.5 hidden px-1 text-xs text-muted lg:block">
          גררו למסמך, או לחצו להוספה
        </p>

        <ul className="-mx-1 mt-2 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:mt-3 lg:flex-col lg:overflow-visible lg:px-0">
          {FIELD_TYPES.map((spec) => (
            <li key={spec.type} className="snap-start">
              <button
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-xtra-field', spec.type)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAdd(spec.type)}
                className="flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white px-3 text-start text-sm text-fg transition-colors hover:border-[var(--color-accent)] hover:bg-blue-50 lg:px-2.5"
              >
                <span aria-hidden="true" className="w-4 shrink-0 text-center">
                  {spec.icon}
                </span>
                <span className="lg:truncate">{spec.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/*
        A quiet save indicator, not a Save button. The spec asks for autosave;
        a button would invite the user to wonder whether they had pressed it.
      */}
      <p
        role="status"
        aria-live="polite"
        className={`mt-2 px-1 text-xs ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {saveState === 'saving'
          ? 'שומר…'
          : saveState === 'saved'
            ? 'נשמר'
            : saveState === 'error'
              ? (saveError ?? 'השמירה נכשלה.')
              : ''}
      </p>
    </div>
  )
}
