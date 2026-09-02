import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

/** One press of the indent button, in points, matching a word processor's tab. */
const STEP = 24
const MAX = STEP * 8

/**
 * Paragraph indentation, the way a word processor does it.
 *
 * Stored as a logical inline margin rather than a nested blockquote, so an
 * indented paragraph is still a paragraph — it keeps its alignment, and it
 * indents from the right in a Hebrew document without any special casing.
 */
export const Indent = Extension.create({
  name: 'indent',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Number.parseInt(element.style.marginInlineStart ?? '', 10) || 0,
            renderHTML: (attributes) =>
              attributes.indent ? { style: `margin-inline-start:${attributes.indent}px` } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ state, chain }) => {
          const { from, to } = state.selection
          let run = chain()
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!this.options.types.includes(node.type.name)) return
            const next = Math.min(MAX, (node.attrs.indent ?? 0) + STEP)
            run = run.command(({ tr }) => {
              tr.setNodeAttribute(pos, 'indent', next)
              return true
            })
          })
          return run.run()
        },
      outdent:
        () =>
        ({ state, chain }) => {
          const { from, to } = state.selection
          let run = chain()
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!this.options.types.includes(node.type.name)) return
            const next = Math.max(0, (node.attrs.indent ?? 0) - STEP)
            run = run.command(({ tr }) => {
              tr.setNodeAttribute(pos, 'indent', next)
              return true
            })
          })
          return run.run()
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      'Shift-Tab': () => this.editor.commands.outdent(),
    }
  },
})
