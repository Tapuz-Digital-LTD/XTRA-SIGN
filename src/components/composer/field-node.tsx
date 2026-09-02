'use client'

import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { FieldType } from '@/lib/fields'

/**
 * An XTRA Sign field living inside the document text.
 *
 * An inline atom: it sits in the flow ("שם מורשה החתימה: [שם מלא]"), survives
 * copy, undo and paste, and serialises with the document. When the document is
 * rendered, each of these becomes a box on the page whose position is measured
 * from the PDF itself — so the field the author placed and the field the signer
 * fills are the same thing, not two coordinates kept in step by hand.
 */

export const FIELD_META: Record<FieldType, { label: string; icon: string; width: string }> = {
  signature: { label: 'חתימה', icon: '✒', width: '11rem' },
  full_name: { label: 'שם מלא', icon: '👤', width: '9rem' },
  text: { label: 'טקסט', icon: '¶', width: '9rem' },
  number: { label: 'מספר', icon: '#', width: '6rem' },
  date: { label: 'תאריך', icon: '📅', width: '7rem' },
  checkbox: { label: 'סימון', icon: '☑', width: '2rem' },
  select: { label: 'בחירה', icon: '▾', width: '9rem' },
  email: { label: 'אימייל', icon: '@', width: '10rem' },
  phone: { label: 'טלפון', icon: '☎', width: '8rem' },
  file: { label: 'קובץ', icon: '📎', width: '9rem' },
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    xtraField: {
      insertXtraField: (attrs: { fieldType: FieldType; label?: string }) => ReturnType
    }
  }
}

function Chip({ node, selected }: NodeViewProps) {
  const type = (node.attrs.fieldType as FieldType) ?? 'text'
  const meta = FIELD_META[type] ?? FIELD_META.text
  return (
    <NodeViewWrapper
      as="span"
      data-xtra-field={type}
      data-xtra-key={node.attrs.fieldKey}
      contentEditable={false}
      className={`mx-0.5 inline-flex select-none items-center gap-1 rounded border-2 border-dashed px-2 py-0.5 align-baseline text-[0.85em] font-medium leading-none ${
        selected ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-400 bg-blue-50 text-blue-800'
      }`}
      style={{ minWidth: meta.width }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{(node.attrs.label as string) || meta.label}</span>
    </NodeViewWrapper>
  )
}

export const XtraFieldNode = Node.create({
  name: 'xtraField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      fieldType: { default: 'text' },
      label: { default: '' },
      /** Unique per field, and what the rendered PDF is searched for. */
      fieldKey: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-xtra-field]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = (node.attrs.fieldType as FieldType) ?? 'text'
    const meta = FIELD_META[type] ?? FIELD_META.text
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-xtra-field': type,
        'data-xtra-key': node.attrs.fieldKey,
        style: `display:inline-block;min-width:${meta.width};border-bottom:1px solid #333;`,
      }),
      // A marker the renderer can find in the PDF text layer, and a blank the
      // reader sees. Never the field's internals.
      `⁣${node.attrs.fieldKey}⁣`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(Chip)
  },

  addCommands() {
    return {
      insertXtraField:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              fieldType: attrs.fieldType,
              label: attrs.label ?? FIELD_META[attrs.fieldType].label,
              fieldKey: `XF${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            },
          }),
    }
  },
})
