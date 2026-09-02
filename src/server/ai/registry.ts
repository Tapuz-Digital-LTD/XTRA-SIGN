import type { StaffSession } from '@/server/auth/session'

/**
 * What the assistant is allowed to do, expressed as the product's own verbs.
 *
 * Every tool calls the same service a screen calls, with the session taken from
 * the server. The model never supplies an organization, a user or a role, so
 * authorization, tenant isolation, validation and audit behave exactly as they
 * do when a person clicks the button — there is no second, weaker path into the
 * system for the assistant to walk through.
 *
 * There is deliberately no tool for SQL, for HTTP, or for anything else that
 * would turn a language model into a way of running arbitrary code.
 */

/**
 * How much ceremony an action deserves.
 *
 * 'safe' runs immediately — reading, searching, and drafts nobody has been sent.
 * 'confirm' asks once, for a change to real data.
 * 'critical' asks twice, for anything that leaves the building or cannot be
 * undone: a send, a bulk send, a deletion, a write into the CRM.
 */
export type ToolRisk = 'safe' | 'confirm' | 'critical'

export type ToolContext = {
  session: StaffSession
  /**
   * Where the user is on screen. A hint for resolving "him" and "this group",
   * never a grant: every tool re-checks access to whatever it is handed.
   */
  screen: ScreenContext
  ip: string | null
  userAgent: string | null
}

export type ScreenContext = {
  page: string | null
  companyId?: string | null
  documentId?: string | null
  groupId?: string | null
  templateId?: string | null
  /** Rows the user has ticked, so "add the ones I selected" works. */
  selectedIds?: string[]
}

export type ToolResult = {
  /** Shown to the user, in Hebrew, in plain language. */
  summary: string
  /** Structured payload the chat renders as cards rather than prose. */
  data?: unknown
  /** What the action touched, for the audit row. */
  target?: { type: string; id: string }
}

export type ToolDefinition<Input = Record<string, unknown>> = {
  name: string
  description: string
  risk: ToolRisk
  /** JSON Schema, handed to the model verbatim. */
  input: Record<string, unknown>
  /** A one-line description of what is about to happen, for the approval card. */
  preview?: (input: Input, context: ToolContext) => Promise<string> | string
  run: (input: Input, context: ToolContext) => Promise<ToolResult>
}

const registry = new Map<string, ToolDefinition<never>>()

export function defineTool<Input>(tool: ToolDefinition<Input>): ToolDefinition<Input> {
  if (registry.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`)
  registry.set(tool.name, tool as ToolDefinition<never>)
  return tool
}

export function getTool(name: string): ToolDefinition<never> | undefined {
  return registry.get(name)
}

export function allTools(): ToolDefinition<never>[] {
  return [...registry.values()]
}

/** A string field. Kept terse because these are written many times over. */
export const str = (description: string) => ({ type: 'string', description })
export const num = (description: string) => ({ type: 'number', description })
export const bool = (description: string) => ({ type: 'boolean', description })
export const strList = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

export function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}
