/**
 * The words and shapes of follow-up tasks. Pure: no database, so the screens
 * import it too and the chip on a row says the same thing the server does.
 */

/**
 * A task a campaign opens after every signature.
 *
 * The key is what a task row carries for ever — the unique index is on
 * (registration, key) — and the label is what the team called it, which they
 * may change whenever they like without disturbing a single existing row.
 */
export type TaskDef = { key: string; label: string }

/** The task this system created before a campaign could name its own. */
export const SITE_PRODUCT: TaskDef = { key: 'site_product', label: 'הקמת מוצר באתר' }

/** Minted by the screen that adds a task; never typed by a person. */
export function isTaskKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_]{1,40}$/i.test(value)
}

/** Four states, whatever the task. The words each kind uses are below. */
export const TASK_STATUSES = {
  pending: 'ממתינה',
  in_progress: 'בטיפול',
  done: 'הושלמה',
  not_needed: 'לא נדרשת',
} as const
export type TaskStatus = keyof typeof TASK_STATUSES

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && value in TASK_STATUSES
}

/**
 * How one kind of task talks.
 *
 * Most take the plain words. Site setup keeps the ones the team has been
 * reading since the campaign opened, because "הוקם באתר" says something
 * "בוצע" does not — and a link there is a product, not a link.
 */
export type TaskWords = {
  statuses: Record<TaskStatus, string>
  /** The button that closes it. */
  markDone: string
  /** The mark on a finished row. */
  done: string
  /** What the link field holds, and how to open it. */
  link: string
  openLink: string
  /** The legend over the four states. */
  state: string
}

const PLAIN: TaskWords = {
  statuses: TASK_STATUSES,
  markDone: 'סמן כהושלמה',
  done: 'הושלמה',
  link: 'קישור',
  openLink: 'פתח את הקישור',
  state: 'מצב המשימה',
}

const SITE: TaskWords = {
  statuses: { pending: 'ממתין להקמה', in_progress: 'בטיפול', done: 'הוקם באתר', not_needed: 'לא נדרש' },
  markDone: 'סמן כהוקם באתר',
  done: 'הוקם באתר',
  link: 'קישור למוצר באתר',
  openLink: 'פתח את המוצר',
  state: 'מצב ההקמה',
}

export function taskWords(kind: string | null | undefined): TaskWords {
  return kind === SITE_PRODUCT.key ? SITE : PLAIN
}

/** The status in this task's own words; an unknown status prints itself. */
export function statusLabel(status: string, kind?: string | null): string {
  return taskWords(kind).statuses[status as TaskStatus] ?? status
}

/** What a row or a drawer needs of a task; dates as ISO strings for the client. */
export type TaskSummary = {
  id: string
  kind: string
  /** The name the campaign gave this task when the row was created. */
  title: string
  status: string
  assigneeUserId: string | null
  dueAt: string | null
  note: string | null
  link: string | null
}

export function summarizeTask(task: { id: string; kind: string; title: string; status: string; assigneeUserId: string | null; dueAt: Date | string | null; note: string | null; link: string | null }): TaskSummary {
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    status: task.status,
    assigneeUserId: task.assigneeUserId,
    dueAt: task.dueAt instanceof Date ? task.dueAt.toISOString() : task.dueAt,
    note: task.note,
    link: task.link,
  }
}
