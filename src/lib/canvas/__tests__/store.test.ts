import { describe, expect, it } from 'vitest'
import { apply, commit, initHistory, redo, undo } from '@/lib/canvas/store'
import { emptyDocument, type CanvasDocument, type CanvasElement } from '@/lib/canvas/model'

const text = (id: string, over: Partial<CanvasElement> = {}): CanvasElement =>
  ({ id, kind: 'text', x: 10, y: 10, width: 50, height: 10, zIndex: 1, text: 'שלום', ...over }) as CanvasElement

function docWith(...elements: CanvasElement[]): CanvasDocument {
  const doc = emptyDocument()
  return { ...doc, pages: [{ ...doc.pages[0], elements }] }
}

describe('canvas commands', () => {
  it('adds an element to the page asked for', () => {
    const next = apply(emptyDocument(), { type: 'add', pageIndex: 0, element: text('a') })
    expect(next.pages[0].elements).toHaveLength(1)
  })

  it('keeps an element on the page when it is dragged past the edge', () => {
    const next = apply(docWith(text('a')), { type: 'update', elementId: 'a', patch: { x: 900 } })
    // 210mm page, 50mm element — the furthest right it can sit is 160.
    expect(next.pages[0].elements[0].x).toBe(160)
  })

  it('refuses to move a locked element', () => {
    const next = apply(docWith(text('a', { locked: true })), {
      type: 'update',
      elementId: 'a',
      patch: { x: 100 },
    })
    expect(next.pages[0].elements[0].x).toBe(10)
  })

  it('refuses to delete a locked element', () => {
    const next = apply(docWith(text('a', { locked: true })), { type: 'delete', elementIds: ['a'] })
    expect(next.pages[0].elements).toHaveLength(1)
  })

  it('gives a duplicate a new id and an offset', () => {
    const next = apply(docWith(text('a')), { type: 'duplicate', elementIds: ['a'] })
    expect(next.pages[0].elements).toHaveLength(2)
    const [original, copy] = next.pages[0].elements
    expect(copy.id).not.toBe(original.id)
    expect(copy.x).toBe(original.x + 5)
  })

  it('brings an element to the front', () => {
    const next = apply(docWith(text('a', { zIndex: 0 }), text('b', { zIndex: 1 })), {
      type: 'reorder',
      elementId: 'a',
      direction: 'front',
    })
    const a = next.pages[0].elements.find((e) => e.id === 'a')!
    const b = next.pages[0].elements.find((e) => e.id === 'b')!
    expect(a.zIndex).toBeGreaterThan(b.zIndex)
  })

  it('centres a single element on the page', () => {
    const next = apply(docWith(text('a')), { type: 'align', elementIds: ['a'], mode: 'center' })
    expect(next.pages[0].elements[0].x).toBeCloseTo(210 / 2 - 25, 6)
  })

  it('aligns several elements to each other rather than to the page', () => {
    const next = apply(docWith(text('a', { x: 20 }), text('b', { x: 80 })), {
      type: 'align',
      elementIds: ['a', 'b'],
      mode: 'left',
    })
    expect(next.pages[0].elements.map((e) => e.x)).toEqual([20, 20])
  })

  it('duplicates a page without reusing element ids', () => {
    const next = apply(docWith(text('a')), { type: 'duplicatePage', pageIndex: 0 })
    expect(next.pages).toHaveLength(2)
    expect(next.pages[1].elements[0].id).not.toBe('a')
  })

  it('never deletes the last page', () => {
    expect(apply(emptyDocument(), { type: 'deletePage', pageIndex: 0 }).pages).toHaveLength(1)
  })

  it('moves a page to a new position', () => {
    const three = apply(apply(emptyDocument(), { type: 'addPage' }), { type: 'addPage' })
    const ids = three.pages.map((p) => p.id)
    const moved = apply(three, { type: 'movePage', from: 0, to: 2 })
    expect(moved.pages.map((p) => p.id)).toEqual([ids[1], ids[2], ids[0]])
  })
})

describe('undo and redo', () => {
  it('walks back and forward through changes', () => {
    let history = initHistory(docWith(text('a')))
    history = commit(history, apply(history.present, { type: 'update', elementId: 'a', patch: { x: 50 } }))
    history = commit(history, apply(history.present, { type: 'update', elementId: 'a', patch: { x: 90 } }))
    expect(history.present.pages[0].elements[0].x).toBe(90)

    history = undo(history)
    expect(history.present.pages[0].elements[0].x).toBe(50)
    history = undo(history)
    expect(history.present.pages[0].elements[0].x).toBe(10)

    history = redo(history)
    expect(history.present.pages[0].elements[0].x).toBe(50)
  })

  it('drops the redo trail once a new change is made', () => {
    let history = initHistory(docWith(text('a')))
    history = commit(history, apply(history.present, { type: 'update', elementId: 'a', patch: { x: 50 } }))
    history = undo(history)
    history = commit(history, apply(history.present, { type: 'update', elementId: 'a', patch: { x: 70 } }))
    expect(history.future).toHaveLength(0)
    expect(redo(history).present.pages[0].elements[0].x).toBe(70)
  })
})
