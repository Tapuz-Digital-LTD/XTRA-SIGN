'use client'

import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'

/**
 * An XTRA Sign field as a first-class part of the document model.
 *
 * Inline atom node: it lives inside the text flow ("שם מורשה החתימה: [שם מלא]"),
 * survives copy/paste/undo, serialises into the document JSON, and carries the
 * same attributes our PlacedField model uses — so when this document becomes a
 * PDF, each node's measured position turns into a PlacedField and the entire
 * existing signing pipeline takes over unchanged.
 */

export type XtraFieldType = 'signature' | 'full_name' | 'date' | 'text' | 'phone' | 'email'

export const XTRA_FIELD_META: Record<XtraFieldType, { label: string; icon: string }> = {
  signature: { label: 'חתימה', icon: '✒️' },
  full_name: { label: 'שם מלא', icon: '👤' },
  date: { label: 'תאריך', icon: '📅' },
  text: { label: 'טקסט', icon: '¶' },
  phone: { label: 'טלפון', icon: '☎' },
  email: { label: 'אימייל', icon: '@' },
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    xtraField: {
      insertXtraField: (attrs: { fieldType: XtraFieldType; label?: string }) => ReturnType
    }
  }
}

function FieldChip({ node, selected }: NodeViewProps) {
  const type = (node.attrs.fieldType as XtraFieldType) ?? 'text'
  const meta = XTRA_FIELD_META[type]
  const signer = node.attrs.ownedBy === 'signer'

  return (
    <NodeViewWrapper
      as="span"
      data-xtra-field={type}
      className={`mx-0.5 inline-flex select-none items-center gap-1 rounded border px-1.5 py-0.5 align-baseline text-[0.85em] font-medium leading-none ${
        selected
          ? 'border-blue-500 bg-blue-100 text-blue-900 ring-2 ring-blue-300'
          : signer
            ? 'border-dashed border-blue-400 bg-blue-50 text-blue-800'
            : 'border-amber-400 bg-amber-50 text-amber-900'
      }`}
      // The chip is an atom: the caret goes around it, never inside.
      contentEditable={false}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{(node.attrs.label as string) || meta.label}</span>
      {node.attrs.required ? <span className="text-red-600">*</span> : null}
    </NodeViewWrapper>
  )
}

export const XtraField = Node.create({
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
      ownedBy: { default: 'signer' },
      required: { default: true },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-xtra-field]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // The static render (copy/paste, print without React) still shows the chip.
    const meta = XTRA_FIELD_META[(node.attrs.fieldType as XtraFieldType) ?? 'text']
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-xtra-field': node.attrs.fieldType }),
      `${meta.icon} ${node.attrs.label || meta.label}`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FieldChip)
  },

  addCommands() {
    return {
      insertXtraField:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { label: XTRA_FIELD_META[attrs.fieldType].label, ...attrs },
          }),
    }
  },
})
