/**
 * The report builder's contract — shared by the engine, the API and the UI.
 *
 * A report is: one entity (what each row is), conditions (AND of clauses,
 * each clause optionally an OR group), columns (which registry fields, in
 * which order), a sort, and a page. Nothing here is SQL: every field is a
 * key into the registry's allowlist, every operator is one the field's type
 * allows, and the engine refuses anything else.
 */

export const REPORT_ENTITIES = ['suppliers', 'customers', 'people', 'agreements', 'tasks', 'sends'] as const
export type ReportEntity = (typeof REPORT_ENTITIES)[number]

export const ENTITY_LABELS: Record<ReportEntity, { label: string; row: string; blurb: string }> = {
  suppliers: { label: 'ספקים', row: 'ספק', blurb: 'כל שורה היא ספק אחד, עם ההסכם והמשימה העדכניים שלו.' },
  customers: { label: 'לקוחות', row: 'לקוח', blurb: 'כל שורה היא לקוח אחד, עם ההסכם והמשימה העדכניים שלו.' },
  people: { label: 'הזמנות והרשמות', row: 'אדם', blurb: 'כל שורה היא אדם שהוזמן או נרשם לקמפיין, מהשליחה ועד החתימה.' },
  agreements: { label: 'הסכמים וחתימות', row: 'הסכם', blurb: 'כל שורה היא הסכם אחד, עם מצב החתימה והשליחות שלו.' },
  tasks: { label: 'משימות המשך', row: 'משימה', blurb: 'כל שורה היא משימה אחת של הקמפיין, למשל הקמת מוצר באתר או שליחת נראות לספק.' },
  sends: { label: 'שליחות והפצות', row: 'שליחה', blurb: 'כל שורה היא הודעה אחת שיצאה (או לא), בלי תוכן ההודעה.' },
}

export type FieldType = 'text' | 'number' | 'date' | 'enum' | 'tags' | 'campaign' | 'user' | 'boolean'

export const OPERATORS = {
  text: ['contains', 'not_contains', 'equals', 'starts_with', 'is_empty', 'is_not_empty'],
  number: ['equals', 'gt', 'lt', 'between', 'is_empty', 'is_not_empty'],
  date: ['between', 'before', 'after', 'last_days', 'is_empty', 'is_not_empty'],
  enum: ['is', 'is_not', 'one_of', 'not_one_of', 'is_empty', 'is_not_empty'],
  tags: ['contains_any', 'contains_all', 'not_contains', 'is_empty', 'is_not_empty'],
  campaign: ['one_of', 'not_one_of', 'is_empty', 'is_not_empty'],
  user: ['is', 'is_not', 'one_of', 'is_empty', 'is_not_empty'],
  boolean: ['is'],
} as const satisfies Record<FieldType, readonly string[]>

export type Operator = (typeof OPERATORS)[FieldType][number]

export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: 'מכיל',
  not_contains: 'לא מכיל',
  equals: 'שווה ל־',
  starts_with: 'מתחיל ב־',
  is: 'הוא',
  is_not: 'אינו',
  one_of: 'הוא אחד מ־',
  not_one_of: 'אינו אחד מ־',
  gt: 'גדול מ־',
  lt: 'קטן מ־',
  between: 'בין',
  before: 'לפני',
  after: 'אחרי',
  last_days: 'ב־N הימים האחרונים',
  contains_any: 'מכיל אחד מ־',
  contains_all: 'מכיל את כולם',
  is_empty: 'ריק',
  is_not_empty: 'לא ריק',
}

/** What the UI needs to render a field: no SQL, only its shape and choices. */
export type FieldMeta = {
  key: string
  label: string
  type: FieldType
  /** Fixed choices for enum fields; user and campaign fields are searched. */
  options?: { value: string; label: string }[]
  /** Shown in the results table before the person picks columns. */
  defaultVisible: boolean
  /** Can be filtered on. */
  filterable: boolean
  /** Can be sorted on. */
  sortable: boolean
  /** Where the field comes from, for grouping in the columns picker. */
  group: string
  /** A form field that exists only in some campaigns. */
  campaignsNote?: string
}

export type ConditionValue = string | number | boolean | string[] | { from?: string; to?: string } | { days: number } | null

export type Condition = { field: string; op: Operator; value?: ConditionValue }

/** AND of clauses; a clause with several conditions is an OR group. */
export type Clause = { any: Condition[] }

export type Sort = { field: string; dir: 'asc' | 'desc' }

export type ReportDefinition = {
  entity: ReportEntity
  clauses: Clause[]
  columns: string[]
  sort?: Sort | null
}

export type RunRequest = ReportDefinition & { page?: number; pageSize?: number }

export type ReportRow = { id: string; cells: Record<string, string | number | boolean | null | string[]>; links: { company?: string; agreement?: string; lead?: string; group?: string; task?: string } }

export type RunResult = { rows: ReportRow[]; total: number; page: number; pageSize: number; columns: FieldMeta[] }

export type SavedReport = { id: string; name: string; definition: ReportDefinition; shared: boolean; ownerUserId: string; ownerName: string | null; updatedAt: string; mine: boolean }

/** A ready-made working view: a definition with a name and a sentence. */
export type PresetView = { key: string; label: string; blurb: string; definition: ReportDefinition }

export const MAX_PAGE_SIZE = 100
export const EXPORT_CAP = 50_000
