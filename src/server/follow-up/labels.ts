/**
 * The words and kinds of follow-up tasks. Pure: no database, so the screens
 * import it too and the chip on a row says the same thing the server does.
 */

export const TASK_KINDS = {
  site_product: { label: 'הקמת מוצר באתר' },
} as const
export type TaskKind = keyof typeof TASK_KINDS

export const TASK_STATUSES = {
  pending: 'ממתין להקמה',
  in_progress: 'בטיפול',
  done: 'הושלם',
  not_needed: 'לא נדרש',
} as const
export type TaskStatus = keyof typeof TASK_STATUSES

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && value in TASK_KINDS
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && value in TASK_STATUSES
}

/** What a row or a drawer needs of a task; dates as ISO strings for the client. */
export type TaskSummary = {
  id: string
  kind: string
  status: string
  assigneeUserId: string | null
  dueAt: string | null
  note: string | null
  link: string | null
}

export function summarizeTask(task: { id: string; kind: string; status: string; assigneeUserId: string | null; dueAt: Date | string | null; note: string | null; link: string | null }): TaskSummary {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    assigneeUserId: task.assigneeUserId,
    dueAt: task.dueAt instanceof Date ? task.dueAt.toISOString() : task.dueAt,
    note: task.note,
    link: task.link,
  }
}
