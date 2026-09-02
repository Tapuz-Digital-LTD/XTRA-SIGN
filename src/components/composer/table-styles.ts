import { TableCell, TableHeader, Table } from '@tiptap/extension-table'

/**
 * The table attributes Word gives you and a plain rich-text editor does not:
 * an explicit table width, a per-cell background, borders and vertical
 * alignment.
 *
 * Declared as real node attributes rather than applied as loose inline styles,
 * so they survive copy, undo, save and the trip through the sanitizer into the
 * rendered PDF — which is the only place the styling actually has to be right.
 */

/** Reads one declaration out of a style attribute, for parsing existing HTML. */
function fromStyle(element: HTMLElement, property: string): string | null {
  return element.style.getPropertyValue(property) || null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    styledTable: {
      /** Sizes the table the cursor is inside, to a fraction of the text column. */
      setTableWidth: (fraction: number | null) => ReturnType
    }
  }
}

/** A4 less the printed margins — the width a full-width table should occupy. */
const TEXT_COLUMN_PX = 703

export const StyledTable = Table.extend({
  addCommands() {
    return {
      ...this.parent?.(),

      /**
       * Table width, expressed as column widths.
       *
       * A resizable table is drawn by prosemirror-tables' own view, which
       * builds the element itself and ignores anything `renderHTML` returns —
       * so a width attribute set on the node would store fine and never appear.
       * Column widths are the model that view does honour, and they are how a
       * word processor sizes a table anyway: the columns decide, the table
       * follows. Passing null hands sizing back to the content.
       */
      setTableWidth:
        (fraction: number | null) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const table = $from.node(depth)
            if (table.type.name !== this.name) continue

            const columns = table.firstChild?.childCount ?? 0
            if (columns === 0) return false
            const width = fraction ? Math.round((TEXT_COLUMN_PX * fraction) / columns) : null

            if (dispatch) {
              const tableStart = $from.before(depth)
              table.descendants((node, pos) => {
                if (!node.type.spec.tableRole?.includes('cell')) return
                // +1 for the table node itself, so the position is the cell's.
                tr.setNodeMarkup(tableStart + 1 + pos, undefined, {
                  ...node.attrs,
                  colwidth: width ? [width] : null,
                })
              })
            }
            return true
          }
          return false
        },
    }
  },
})

const CELL_ATTRIBUTES = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => fromStyle(element, 'background-color'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.backgroundColor ? { style: `background-color:${attributes.backgroundColor}` } : {},
  },
  verticalAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => fromStyle(element, 'vertical-align'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.verticalAlign ? { style: `vertical-align:${attributes.verticalAlign}` } : {},
  },
  borderColor: {
    default: null,
    parseHTML: (element: HTMLElement) => fromStyle(element, 'border-color'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.borderColor ? { style: `border-color:${attributes.borderColor}` } : {},
  },
}

export const StyledTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...CELL_ATTRIBUTES }
  },
})

export const StyledTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...CELL_ATTRIBUTES }
  },
})
