import { Node } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType
    }
  }
}

/**
 * A page break the author puts in on purpose.
 *
 * Shown as a labelled divider while editing; in the rendered PDF it is a real
 * `break-before: page`, which is the only thing that matters once the document
 * leaves the screen.
 */
export const PageBreakNode = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML() {
    return ['div', { 'data-page-break': 'true', style: 'break-before:page;page-break-before:always;height:0' }]
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
})
