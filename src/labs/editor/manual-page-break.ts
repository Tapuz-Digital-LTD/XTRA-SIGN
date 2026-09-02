import { Node } from '@tiptap/core'

/**
 * A manual page break the author places on purpose.
 *
 * In the editor it renders as a labelled divider; in print CSS it forces
 * `break-before: page`. Whether the on-screen pagination extension pushes the
 * following content to the next page box is one of the questions this spike
 * answers — the print/PDF behaviour is ours either way.
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    manualPageBreak: {
      insertPageBreak: () => ReturnType
    }
  }
}

export const ManualPageBreak = Node.create({
  name: 'manualPageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-manual-page-break]' }]
  },

  renderHTML() {
    return ['div', { 'data-manual-page-break': 'true', class: 'xtra-page-break' }]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
})
