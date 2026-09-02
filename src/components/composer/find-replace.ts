import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setSearchTerm: (term: string) => ReturnType
      goToMatch: (delta: number) => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

export const findReplaceKey = new PluginKey<FindState>('xtraFindReplace')

type Match = { from: number; to: number }
type FindState = { term: string; matches: Match[]; current: number; decorations: DecorationSet }

/** Everything a user could type is treated as literal text, never as a pattern. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Walks the document's text and records every occurrence.
 *
 * Positions come from the document rather than from a flattened string: a match
 * that spans two text nodes — which any styled word does — would otherwise be
 * replaced at the wrong offset.
 */
function findMatches(doc: import('@tiptap/pm/model').Node, term: string): Match[] {
  if (!term) return []
  const matches: Match[] = []
  const pattern = new RegExp(escapeRegExp(term), 'gi')

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const text = node.textBetween(0, node.content.size, undefined, '￼')
    pattern.lastIndex = 0
    let hit: RegExpExecArray | null
    while ((hit = pattern.exec(text)) !== null) {
      if (hit[0].length === 0) break
      matches.push({ from: pos + 1 + hit.index, to: pos + 1 + hit.index + hit[0].length })
    }
  })
  return matches
}

function decorate(matches: Match[], current: number, doc: import('@tiptap/pm/model').Node) {
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === current ? 'xtra-find-current' : 'xtra-find-match',
      }),
    ),
  )
}

/**
 * Find and replace.
 *
 * Written here rather than installed: the free Tiptap extensions do not include
 * one, and the behaviour is small enough that a dependency would cost more than
 * it saves. Replacements run back to front so that each edit cannot shift the
 * positions of the matches still to be applied.
 */
export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findReplaceKey,
        state: {
          init: (_config, state) => ({
            term: '',
            matches: [],
            current: 0,
            decorations: DecorationSet.create(state.doc, []),
          }),
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(findReplaceKey) as { term?: string; current?: number } | undefined
            const term = meta?.term ?? value.term
            if (!meta && !tr.docChanged) return value

            const matches = findMatches(state.doc, term)
            const current = matches.length
              ? ((meta?.current ?? value.current) % matches.length + matches.length) % matches.length
              : 0
            return { term, matches, current, decorations: decorate(matches, current, state.doc) }
          },
        },
        props: {
          decorations: (state) => findReplaceKey.getState(state)?.decorations,
        },
      }),
    ]
  },

  addCommands() {
    return {
      setSearchTerm:
        (term) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplaceKey, { term, current: 0 }))
          return true
        },

      goToMatch:
        (delta) =>
        ({ state, tr, dispatch, view }) => {
          const found = findReplaceKey.getState(state)
          if (!found?.matches.length) return false
          const next = found.current + delta
          if (dispatch) dispatch(tr.setMeta(findReplaceKey, { current: next }))
          // Bring it into view; a counter that says "3 of 9" is no use if the
          // third match is off screen.
          const wrapped = ((next % found.matches.length) + found.matches.length) % found.matches.length
          const target = found.matches[wrapped]
          if (target) view.dispatch(view.state.tr.scrollIntoView())
          return true
        },

      replaceCurrent:
        (replacement) =>
        ({ state, chain }) => {
          const found = findReplaceKey.getState(state)
          const match = found?.matches[found.current]
          if (!match) return false
          return chain().insertContentAt({ from: match.from, to: match.to }, replacement).run()
        },

      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const found = findReplaceKey.getState(state)
          if (!found?.matches.length) return false
          // Back to front: an earlier replacement would otherwise move every
          // later match by the difference in length.
          for (const match of [...found.matches].reverse()) {
            tr.insertText(replacement, match.from, match.to)
          }
          if (dispatch) dispatch(tr.setMeta(findReplaceKey, { current: 0 }))
          return true
        },
    }
  },
})
