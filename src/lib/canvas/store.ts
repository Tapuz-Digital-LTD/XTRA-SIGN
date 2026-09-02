import {
  clampToPage,
  emptyPage,
  findElement,
  newId,
  topZIndex,
  type CanvasDocument,
  type CanvasElement,
  type CanvasPage,
  type PageBackground,
} from './model'

/**
 * Every change the editor can make to a document, as pure functions.
 *
 * Written apart from the canvas on purpose: the same operations serve the
 * mouse, the keyboard, the layers panel and XTRA AI. One implementation means
 * "move the logo" does exactly the same thing whether a person dragged it or
 * asked for it, and undo behaves identically either way.
 */

export type Command =
  | { type: 'add'; pageIndex: number; element: CanvasElement }
  | { type: 'update'; elementId: string; patch: Partial<CanvasElement> }
  | { type: 'delete'; elementIds: string[] }
  | { type: 'duplicate'; elementIds: string[] }
  | { type: 'reorder'; elementId: string; direction: 'forward' | 'backward' | 'front' | 'back' }
  | { type: 'addPage'; afterIndex?: number }
  | { type: 'duplicatePage'; pageIndex: number }
  | { type: 'deletePage'; pageIndex: number }
  | { type: 'movePage'; from: number; to: number }
  | { type: 'setBackground'; pageIndex: number; background: PageBackground }
  | { type: 'setTitle'; title: string }
  | { type: 'align'; elementIds: string[]; mode: AlignMode }

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'page-center'

const PAGE_W = 210
const PAGE_H = 297

function mapPage(
  document: CanvasDocument,
  pageIndex: number,
  change: (page: CanvasPage) => CanvasPage,
): CanvasDocument {
  return {
    ...document,
    pages: document.pages.map((page, index) => (index === pageIndex ? change(page) : page)),
  }
}

function mapElements(
  document: CanvasDocument,
  change: (element: CanvasElement, page: CanvasPage) => CanvasElement | null,
): CanvasDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      elements: page.elements
        .map((element) => change(element, page))
        .filter((element): element is CanvasElement => element !== null),
    })),
  }
}

export function apply(document: CanvasDocument, command: Command): CanvasDocument {
  switch (command.type) {
    case 'add':
      return mapPage(document, command.pageIndex, (page) => ({
        ...page,
        elements: [...page.elements, clampToPage(command.element)],
      }))

    case 'update':
      return mapElements(document, (element) =>
        element.id === command.elementId
          ? // Locked elements ignore edits, which is the whole point of locking.
            element.locked && !('locked' in command.patch)
            ? element
            : (clampToPage({ ...element, ...command.patch } as CanvasElement) as CanvasElement)
          : element,
      )

    case 'delete': {
      const doomed = new Set(command.elementIds)
      return mapElements(document, (element) =>
        doomed.has(element.id) && !element.locked ? null : element,
      )
    }

    case 'duplicate': {
      const wanted = new Set(command.elementIds)
      return {
        ...document,
        pages: document.pages.map((page) => {
          const copies = page.elements
            .filter((element) => wanted.has(element.id))
            .map((element, offset) =>
              clampToPage({
                ...element,
                id: newId(),
                // Offset so the copy is visibly a copy rather than hidden
                // exactly behind the original.
                x: element.x + 5,
                y: element.y + 5,
                zIndex: topZIndex(page) + offset,
                locked: false,
              }),
            )
          return copies.length ? { ...page, elements: [...page.elements, ...copies] } : page
        }),
      }
    }

    case 'reorder': {
      const located = findElement(document, command.elementId)
      if (!located) return document
      const { page, element } = located
      const sorted = [...page.elements].sort((a, b) => a.zIndex - b.zIndex)
      const position = sorted.findIndex((candidate) => candidate.id === element.id)

      const target =
        command.direction === 'front'
          ? sorted.length - 1
          : command.direction === 'back'
            ? 0
            : command.direction === 'forward'
              ? Math.min(position + 1, sorted.length - 1)
              : Math.max(position - 1, 0)

      const reordered = [...sorted]
      reordered.splice(position, 1)
      reordered.splice(target, 0, element)

      // Rewritten as a dense sequence so repeated moves cannot drift apart.
      const order = new Map(reordered.map((candidate, index) => [candidate.id, index]))
      return mapElements(document, (candidate) => ({
        ...candidate,
        zIndex: order.get(candidate.id) ?? candidate.zIndex,
      }))
    }

    case 'addPage': {
      const at = command.afterIndex ?? document.pages.length - 1
      const pages = [...document.pages]
      pages.splice(at + 1, 0, emptyPage())
      return { ...document, pages }
    }

    case 'duplicatePage': {
      const source = document.pages[command.pageIndex]
      if (!source) return document
      const copy: CanvasPage = {
        id: newId(),
        background: source.background,
        // New ids throughout: two elements sharing an id would make every
        // later edit ambiguous.
        elements: source.elements.map((element) => ({ ...element, id: newId() })),
      }
      const pages = [...document.pages]
      pages.splice(command.pageIndex + 1, 0, copy)
      return { ...document, pages }
    }

    case 'deletePage':
      // A document always has a page; deleting the last one would leave the
      // editor with nothing to draw on.
      if (document.pages.length <= 1) return document
      return { ...document, pages: document.pages.filter((_, index) => index !== command.pageIndex) }

    case 'movePage': {
      const pages = [...document.pages]
      const [moved] = pages.splice(command.from, 1)
      if (!moved) return document
      pages.splice(Math.min(Math.max(command.to, 0), pages.length), 0, moved)
      return { ...document, pages }
    }

    case 'setBackground':
      return mapPage(document, command.pageIndex, (page) => ({
        ...page,
        background: { ...page.background, ...command.background },
      }))

    case 'setTitle':
      return { ...document, title: command.title.slice(0, 200) }

    case 'align': {
      const wanted = new Set(command.elementIds)
      const chosen = document.pages
        .flatMap((page) => page.elements)
        .filter((element) => wanted.has(element.id))
      if (chosen.length === 0) return document

      // One element aligns to the page; several align to each other, which is
      // what a person means by "line these up".
      const single = chosen.length === 1 || command.mode === 'page-center'
      const left = Math.min(...chosen.map((element) => element.x))
      const right = Math.max(...chosen.map((element) => element.x + element.width))
      const top = Math.min(...chosen.map((element) => element.y))
      const bottom = Math.max(...chosen.map((element) => element.y + element.height))

      return mapElements(document, (element) => {
        if (!wanted.has(element.id) || element.locked) return element
        switch (command.mode) {
          case 'left':
            return { ...element, x: single ? 0 : left }
          case 'right':
            return { ...element, x: (single ? PAGE_W : right) - element.width }
          case 'center':
            return { ...element, x: (single ? PAGE_W : left + right) / 2 - element.width / 2 }
          case 'top':
            return { ...element, y: single ? 0 : top }
          case 'bottom':
            return { ...element, y: (single ? PAGE_H : bottom) - element.height }
          case 'middle':
            return { ...element, y: (single ? PAGE_H : top + bottom) / 2 - element.height / 2 }
          case 'page-center':
            return {
              ...element,
              x: PAGE_W / 2 - element.width / 2,
              y: PAGE_H / 2 - element.height / 2,
            }
          default:
            return element
        }
      })
    }

    default:
      return document
  }
}

/**
 * Undo history.
 *
 * Bounded, because a document with images is large and an unbounded stack of
 * whole copies is a memory leak with a long fuse.
 */
const HISTORY_LIMIT = 60

export type History = {
  past: CanvasDocument[]
  present: CanvasDocument
  future: CanvasDocument[]
}

export function initHistory(document: CanvasDocument): History {
  return { past: [], present: document, future: [] }
}

export function commit(history: History, next: CanvasDocument): History {
  if (next === history.present) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  }
}

export function undo(history: History): History {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
  }
}

export function redo(history: History): History {
  const [next, ...rest] = history.future
  if (!next) return history
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: rest }
}
