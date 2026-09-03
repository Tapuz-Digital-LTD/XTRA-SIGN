import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Every table carries organizationId from day one even though the UI exposes no
 * organizations yet. Adding a tenant column later means backfilling every row
 * and auditing every query; having it unused costs one column.
 *
 * All timestamps are `timestamptz`. `timestamp` without a zone stores whatever
 * the session offset happens to be, and a signature time that is silently an
 * hour off is not a defensible record.
 */

export const agreementStatus = pgEnum('agreement_status', [
  'draft',
  'sent',
  'viewed',
  'signed',
  'declined',
  'expired',
  'canceled',
])

export const fieldOwner = pgEnum('field_owner', ['sender', 'signer'])

export const fieldType = pgEnum('field_type', [
  'signature',
  'full_name',
  'text',
  'number',
  'date',
  'checkbox',
  'select',
  'email',
  'phone',
  'file',
])

/** Two levels, as agreed. Anything finer is a permission system nobody asked for. */
export const userRole = pgEnum('user_role', ['admin', 'user'])

export const companyKind = pgEnum('company_kind', ['supplier', 'customer'])
export const deliveryChannel = pgEnum('delivery_channel', ['email', 'sms'])

export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sent', 'failed'])

/**
 * The organization using XTRA Sign, and the details that appear on the
 * documents it sends.
 *
 * One source for "our" side of every agreement. Templates and the assistant
 * both read it, so the legal name and company number are never typed into a
 * prompt or hard-coded — changing them here changes every document made after.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** The name that belongs on a contract, when it differs from the everyday one. */
  legalName: text('legal_name'),
  taxId: text('tax_id'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  /** A URL for the letterhead; images are embedded when a document is rendered. */
  logoUrl: text('logo_url'),
  /**
   * The brand kit a designed document follows.
   *
   * Held here rather than described in a prompt, so "design it in XTRA's
   * colours" resolves to the same values every time and can be corrected in one
   * place when the brand changes.
   */
  brandPrimary: text('brand_primary'),
  brandAccent: text('brand_accent'),
  brandFont: text('brand_font'),
  footerText: text('footer_text'),
  /**
   * Where event emails go and which events send them, as
   * `{ emails: string[], events: Record<string, boolean> }`. In a column
   * rather than a table because there is one organization per row and the
   * whole object is read and written together from one settings screen.
   */
  notificationPrefs: jsonb('notification_prefs'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * A supplier or a customer the organization signs agreements with.
 *
 * Exists so a document is filed under the party it concerns rather than living
 * in one flat list of everything ever sent. "McDonald's" is a company;
 * every agreement with them hangs off this row, and its page is where they are
 * managed — signed copies downloaded, a new one started.
 *
 * `kind` splits the two spaces the UI keeps apart: suppliers in one place,
 * customers in another. Everything else is contact detail an operator fills in
 * over time, all optional so a company can be created from just a name.
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: companyKind('kind').notNull(),
    name: text('name').notNull(),
    /** ח.פ / ע.מ — the company's registration number, free text. */
    taxId: text('tax_id'),
    contactName: text('contact_name'),
    /** Stored as given; used to prefill a recipient, not as a login credential. */
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    notes: text('notes'),
    /**
     * Links this company to a record in the external CRM, so a signed agreement
     * can be pushed straight onto the right supplier/customer there.
     *
     * `crmRecordId` is the record's GUID in the CRM. `crmObjectType` is the
     * CRM's object number; when null it is derived from `kind` (customer → the
     * CRM's account object, supplier → its vendor object), which is the common
     * case — an operator normally only pastes the record id.
     */
    crmRecordId: text('crm_record_id'),
    crmObjectType: integer('crm_object_type'),
    address: text('address'),
    /**
     * Where the record first came from — 'crm' when imported from Fireberry,
     * 'xtra' when created here. Kept for audit only: whether a record is shown
     * as CRM-linked is decided by crmRecordId, not by this, because a local
     * record can later be linked to the CRM.
     */
    source: text('source').default('xtra').notNull(),
    crmSyncedAt: timestamp('crm_synced_at', { withTimezone: true }),
    /** Soft delete: agreements keep pointing at the company they were filed under. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('companies_org_kind_idx').on(t.organizationId, t.kind),
    // A Fireberry record maps to exactly one company. Object type is part of the
    // key so a customer (object 1) and a supplier (object 1000) that happen to
    // share a GUID are still distinct. Partial: local records (null id) are free.
    uniqueIndex('companies_crm_unique')
      .on(t.organizationId, t.crmObjectType, t.crmRecordId)
      .where(sql`${t.crmRecordId} is not null`),
  ],
)

/**
 * The high-water mark for the Fireberry read-sync, per organization and object.
 *
 * Holds the latest `modifiedon` already imported, so the next sync asks Fireberry
 * only for records changed since then instead of pulling everything again.
 */
export const crmSyncState = pgTable(
  'crm_sync_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    objectType: integer('object_type').notNull(),
    /** Fireberry's `modifiedon` of the newest record imported, as its raw string. */
    watermark: text('watermark'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('crm_sync_state_unique').on(t.organizationId, t.objectType)],
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /**
     * The login identity. There are no passwords: a person proves who they are
     * by holding the SIM, so the phone number is the credential and must be
     * unique across the whole system, not merely within an organization.
     *
     * Stored in the E.164 form `normalizeIsraeliPhone` produces, so that
     * `05X-XXX-XXXX`, `+9725X...` and `9725X...` cannot become three accounts.
     */
    phone: text('phone').notNull(),
    role: userRole('role').default('user').notNull(),
    isAdmin: boolean('is_admin').default(false).notNull(),
    /** Set to lock an account out. Never delete a user: audit rows reference them. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email), uniqueIndex('users_phone_unique').on(t.phone)],
)

/**
 * A pending invitation. Only the hash is stored, so a database dump is not a
 * set of working invitations.
 */
/**
 * Rate limit counters.
 *
 * In the database rather than in process memory because production runs several
 * tasks: an in-memory counter multiplies every limit by the task count and
 * resets on deploy, which is when someone is most likely to be hammering the
 * login form.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('rate_limits_bucket_window_unique').on(t.bucket, t.windowStart),
    index('rate_limits_expiry_idx').on(t.expiresAt),
  ],
)

/**
 * Admin actions worth being able to answer questions about later: who invited
 * whom, who disabled an account, who changed a role.
 *
 * Separate from auditEvents, which is scoped to one agreement.
 */
export const adminAuditEvents = pgTable(
  'admin_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    type: text('type').notNull(),
    actorEmail: text('actor_email').notNull(),
    targetEmail: text('target_email'),
    ip: text('ip'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('admin_audit_org_idx').on(t.organizationId, t.createdAt)],
)

/**
 * Staff login sessions. Only a hash is stored: a database dump must not be a
 * set of usable sessions. The browser holds an opaque HttpOnly cookie.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionHash: text('session_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('user_sessions_hash_unique').on(t.sessionHash)],
)

/**
 * A pending SMS login code.
 *
 * Deliberately its own table rather than a column on `users` or a reuse of
 * `otp_challenges`. `otp_challenges` belongs to a signer and is referenced by
 * the signing audit trail, which carries legal weight; entangling staff logins
 * with it would put two unrelated state machines in one row and make the
 * signer's evidence harder to reason about.
 */
export const loginChallenges = pgTable(
  'login_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    resendCount: integer('resend_count').default(0).notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('login_challenges_user_idx').on(t.userId)],
)

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    /** The composer's source text, or null when the template wraps an uploaded file. */
    content: jsonb('content'),
    /** The PDF every document made from this template starts as. Copied, never shared. */
    sourceFileKey: text('source_file_key'),
    /**
     * The field layout, as a snapshot of the same shape the editor saves. Copied
     * onto each new document through the same validation the editor's autosave
     * goes through, so a template cannot smuggle in what the editor refuses.
     */
    fields: jsonb('fields'),
    /** The canvas document this template was designed from, when it was. */
    canvasDocument: jsonb('canvas_document'),
    pageCount: integer('page_count'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** Soft: agreements keep pointing at the template they were made from. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** 'crm' when imported from Fireberry; null for one made here. */
    source: text('source'),
    /** The Fireberry PrintTemplate this was imported from. */
    crmTemplateId: text('crm_template_id'),
    /** That template's `modifiedon` at the moment of import — provenance, not a watermark. */
    crmModifiedOn: text('crm_modified_on'),
    /**
     * SHA-256 of the raw `templatebody` as fetched, before sanitising.
     *
     * This is what makes a version a version. Identity is (template, content),
     * so re-importing unchanged content is refused while an edited template
     * imports as a new row and the old one is left exactly as it was.
     */
    crmContentHash: text('crm_content_hash'),
    /** The merge tokens found in the body, for the editor to offer as fields. */
    crmMergeFields: jsonb('crm_merge_fields'),
    /**
     * The exact HTML that produced this template's PDF.
     *
     * Kept so a later change can re-render it — to place fields automatically,
     * say — without needing Fireberry to still hold that version.
     */
    crmSourceHtmlKey: text('crm_source_html_key'),
  },
  (t) => [
    index('templates_org_idx').on(t.organizationId),
    uniqueIndex('templates_crm_version_unique')
      .on(t.organizationId, t.crmTemplateId, t.crmContentHash)
      .where(sql`${t.crmTemplateId} is not null`),
  ],
)

/**
 * A named, hand-picked list of companies — a campaign, a season, a project.
 *
 * Deliberately not a saved search. "ספקי פסח" is a decision someone made about
 * which suppliers belong, and a query that re-derives it every time would
 * quietly change the list under them between one send and the next.
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * 'supplier' | 'customer'. Suppliers and customers are organised
     * separately: a group is a shortlist you send an agreement to, and the
     * agreement you send a supplier is not the one you send a customer.
     *
     * Nullable for the groups that existed before the split, which stay mixed
     * and appear under both.
     */
    kind: text('kind'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Soft: batches and agreements keep pointing at the group they came from. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Archived: off the main screen, nothing else. The project, its suppliers,
     * leads and agreements all stay exactly as they are, and one click brings
     * it back. Never a deletion.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /**
     * Projects (the UX name for a group since Simple V1) can open a public
     * joining form. The slug is the public address — random, not guessable
     * from the name, because the form must be shareable without exposing
     * anything else about the organization.
     */
    landingEnabled: boolean('landing_enabled').default(false).notNull(),
    landingSlug: text('landing_slug'),
    /** Title, description, success message and the form's field list. */
    landingConfig: jsonb('landing_config'),
    /** Extra addresses this project notifies about new leads, beyond the org's. */
    notifyEmails: jsonb('notify_emails'),
  },
  (t) => [
    index('groups_org_idx').on(t.organizationId),
    uniqueIndex('groups_landing_slug_unique')
      .on(t.landingSlug)
      .where(sql`${t.landingSlug} is not null`),
  ],
)

/**
 * A submission from a project's public joining form.
 *
 * Deliberately not a company: whoever filled the form is unvetted, and the
 * suppliers list must stay a list someone decided on. A lead becomes a
 * supplier only when a person approves it — that is the whole point of the
 * table existing separately.
 */
export const projectLeads = pgTable(
  'project_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    /** new | approved | rejected */
    status: text('status').default('new').notNull(),
    /** What was submitted, exactly as submitted: name, taxId, contact… */
    data: jsonb('data').notNull(),
    /** The supplier created on approval, so the lead always leads somewhere. */
    companyId: uuid('company_id').references(() => companies.id),
    /** Which door the submission came through: 'landing' | 'embed' | 'api'. */
    source: text('source').default('landing').notNull(),
    ip: text('ip'),
    /**
     * The form's fields as they were at the moment of submission. The form
     * changes; the lead must stay readable as it was asked, forever.
     */
    formSnapshot: jsonb('form_snapshot'),
    /** The page an embedded form sat on. Display only, capped, never trusted. */
    referrer: text('referrer'),
    /**
     * A caller-supplied key so an API integration can retry a submission
     * without minting a second lead. Unique per project when present.
     */
    idempotencyKey: text('idempotency_key'),
    /**
     * Campaign attribution, kept apart from `data` so it never shows up as a
     * form answer: UTM fields, the landing URL, the form version. Whitelisted
     * and capped on write — never raw query strings.
     */
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
  },
  (t) => [
    index('project_leads_group_idx').on(t.groupId, t.status, t.createdAt),
    uniqueIndex('project_leads_idempotency_unique')
      .on(t.groupId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
)

/** Membership. A company may belong to any number of groups. */
export const companyGroups = pgTable(
  'company_groups',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.companyId] }),
    index('company_groups_company_idx').on(t.companyId),
  ],
)

/**
 * One press of "send to the group".
 *
 * Kept because membership changes: a company can leave "משרד התיירות 2026"
 * next month, and the question "which agreements went out in that campaign"
 * must still have an answer. It is also what makes a retry safe — the batch
 * plus the company is the idempotency key, so re-running a failed send cannot
 * produce a second agreement for a company that already got one.
 */
export const bulkBatches = pgTable(
  'bulk_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    groupId: uuid('group_id').references(() => groups.id),
    templateId: uuid('template_id').references(() => templates.id),
    /** The group's name when the batch ran, so history reads correctly after a rename. */
    groupName: text('group_name'),
    templateName: text('template_name'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    totalRequested: integer('total_requested').notNull().default(0),
  },
  (t) => [index('bulk_batches_org_idx').on(t.organizationId, t.createdAt)],
)

/** One company's place in a batch: what happened, and what came of it. */
export const bulkBatchItems = pgTable(
  'bulk_batch_items',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => bulkBatches.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    agreementId: uuid('agreement_id'),
    /** pending | sent | failed | skipped */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The idempotency key: one row per company per batch, so a retry updates
    // rather than duplicating.
    primaryKey({ columns: [t.batchId, t.companyId] }),
    index('bulk_batch_items_agreement_idx').on(t.agreementId),
  ],
)

/**
 * Things that happened which someone should know about.
 *
 * Organization-wide rather than per-user: a small team all needs to see that a
 * document came back signed, and routing each event to one owner would hide it
 * from whoever is actually at the desk. Every row points at the document it is
 * about, so an unread badge always leads somewhere.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** signed | declined | expired | send_failed | crm_failed | new_lead */
    type: text('type').notNull(),
    agreementId: uuid('agreement_id'),
    /** Where clicking the notification goes when it is not about an agreement. */
    link: text('link'),
    /** Rendered when written, so a later rename does not rewrite history. */
    title: text('title').notNull(),
    body: text('body'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('notifications_org_idx').on(t.organizationId, t.createdAt),
    /**
     * One notification per event per document. A reminder job or a retried
     * write-back must not turn into a second copy of the same news.
     */
    uniqueIndex('notifications_event_unique')
      .on(t.organizationId, t.type, t.agreementId)
      .where(sql`${t.agreementId} is not null`),
  ],
)

export const agreements = pgTable(
  'agreements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    templateId: uuid('template_id').references(() => templates.id),
    /** The supplier/customer this agreement is filed under, if any. */
    companyId: uuid('company_id').references(() => companies.id),
    /** The Fireberry file id this document was imported from, if any. Dedup key. */
    crmDocumentId: text('crm_document_id'),
    /**
     * How the document came to exist: 'uploaded' | 'composed' | 'xtra_template'
     * | 'crm_document'. Null on rows from before this column — display derives
     * those best-effort and never guesses in writes.
     */
    sourceKind: text('source_kind'),
    /** Flow 4: the CRM business record this document was made from (a quote, an order). */
    crmObjectType: integer('crm_object_type'),
    crmRecordId: text('crm_record_id'),
    /** The values used at creation, frozen. A later CRM edit never reaches a sent document. */
    mergeSnapshot: jsonb('merge_snapshot'),
    /** done | failed | null — pushing the signed PDF back to the source record. */
    crmWritebackState: text('crm_writeback_state'),
    crmWritebackAt: timestamp('crm_writeback_at', { withTimezone: true }),
    crmWritebackError: text('crm_writeback_error'),
    /**
     * The canvas document this agreement was designed from.
     *
     * Kept alongside the rendered PDF rather than instead of it: the PDF is
     * what was signed and must never change, while this is what the editor and
     * XTRA AI reopen to make the next version. Null for documents that arrived
     * as a PDF or came from the older composer, which stay readable exactly as
     * they are.
     */
    canvasDocument: jsonb('canvas_document'),
    title: text('title').notNull(),
    status: agreementStatus('status').default('draft').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    currentVersionId: uuid('current_version_id'),
    /** Set when a "edit and resend" produced this as a successor. */
    supersedesId: uuid('supersedes_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('agreements_org_status_idx').on(t.organizationId, t.status),
    index('agreements_owner_idx').on(t.ownerId),
    index('agreements_company_idx').on(t.companyId),
    uniqueIndex('agreements_crm_document_unique')
      .on(t.organizationId, t.crmDocumentId)
      .where(sql`${t.crmDocumentId} is not null`),
  ],
)

/**
 * An immutable snapshot of what was actually sent. A signed version is never
 * mutated — "edit and resend" writes a new row, so V1 stays byte-identical to
 * what the signer saw.
 */
export const agreementVersions = pgTable(
  'agreement_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => agreements.id),
    versionNumber: integer('version_number').notNull(),
    /** Storage keys, never URLs — URLs are minted short-lived on demand. */
    sourceFileKey: text('source_file_key'),
    renderedFileKey: text('rendered_file_key'),
    signedFileKey: text('signed_file_key'),
    /** SHA-256 of the rendered PDF as sent. */
    renderedHash: text('rendered_hash'),
    /** SHA-256 of the final signed PDF. */
    signedHash: text('signed_hash'),
    pageCount: integer('page_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('versions_agreement_number_unique').on(t.agreementId, t.versionNumber)],
)

/**
 * The real geometry of one page.
 *
 * Pages in one document are not all the same size and are not necessarily A4:
 * an appendix can be Letter, a plan can be landscape. Field positions are
 * fractions of THIS page, so these numbers are what turn a fraction back into
 * a point on the page when the signed PDF is produced.
 */
export const documentPages = pgTable(
  'document_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agreementVersionId: uuid('agreement_version_id')
      .notNull()
      .references(() => agreementVersions.id),
    pageNumber: integer('page_number').notNull(),
    /**
     * The page's own size in PDF points — never assumed, always measured.
     *
     * This is the whole record now. There used to be a rendered image size in
     * pixels alongside it, from when pages were rasterised server-side; the
     * browser draws the PDF itself, so the aspect ratio it needs comes from
     * these two numbers and nothing has to agree with a stored image.
     */
    widthPt: doublePrecision('width_pt').notNull(),
    heightPt: doublePrecision('height_pt').notNull(),
  },
  (t) => [uniqueIndex('document_pages_version_number_unique').on(t.agreementVersionId, t.pageNumber)],
)

export const recipients = pgTable(
  'recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => agreements.id),
    name: text('name').notNull(),
    company: text('company'),
    /** E.164. Normalised on write so rate limits key on one spelling. */
    phone: text('phone'),
    email: text('email'),
    /** How this recipient proved who they are. 'none' until verified. */
    verifiedVia: text('verified_via'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
  },
  (t) => [index('recipients_agreement_idx').on(t.agreementId)],
)

/**
 * The signing link.
 *
 * NOT one-time-use: a signer may close the browser and reopen the same link for
 * as long as the request is live. Only the OTP is single-use. The token stays
 * valid until expiry, revocation, or the agreement leaving an open status.
 *
 * Only the hash is stored. A leaked database dump must not be a set of working
 * signing links.
 */
export const signingTokens = pgTable(
  'signing_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('signing_tokens_hash_unique').on(t.tokenHash)],
)

/**
 * Issued after a successful OTP so a refresh or a reopened tab does not
 * re-challenge the signer. Server-side; the browser only holds an opaque
 * HttpOnly cookie.
 */
export const signingSessions = pgTable(
  'signing_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id),
    signingTokenId: uuid('signing_token_id')
      .notNull()
      .references(() => signingTokens.id),
    sessionHash: text('session_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('signing_sessions_hash_unique').on(t.sessionHash)],
)

/**
 * OTP challenge. Codes are hashed, single-use, and bound to one recipient —
 * never global to a phone number, so one signer's attempts cannot lock out
 * another's.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id),
    codeHash: text('code_hash').notNull(),
    destination: text('destination').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    resendCount: integer('resend_count').default(0).notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('otp_recipient_idx').on(t.recipientId)],
)

export const fields = pgTable(
  'fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agreementVersionId: uuid('agreement_version_id')
      .notNull()
      .references(() => agreementVersions.id),
    type: fieldType('type').notNull(),
    /** Shown to the user. The internal `{{key}}` is derived, never typed. */
    label: text('label').notNull(),
    variableKey: text('variable_key'),
    ownedBy: fieldOwner('owned_by').notNull(),
    required: boolean('required').default(true).notNull(),
    page: integer('page').default(1).notNull(),
    /**
     * Position and size as FRACTIONS of the page, 0..1, with the origin at the
     * page's top-left.
     *
     * Never pixels and never points: a pixel value is tied to the width the
     * editor happened to render at, so the same field would land somewhere else
     * on a phone, on a landscape page, or on Letter. A fraction multiplied by
     * this page's own measured size is the same physical spot everywhere.
     */
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    options: jsonb('options'),
    value: text('value'),
    /** Hint text for a field the signer fills — a title separate from the value. */
    placeholder: text('placeholder'),
    /** Filled by the system at signing time (a date field stamped with the signing date). */
    autoFill: boolean('auto_fill').default(false).notNull(),
    /**
     * Where a sender-filled field takes its value from, for a template sent to
     * many companies at once: 'company.name', 'company.tax_id' and so on.
     *
     * Null means someone types it. This is what makes a bulk send produce a
     * different document per company rather than the same PDF forty times.
     */
    autoSource: text('auto_source'),
    filledAt: timestamp('filled_at', { withTimezone: true }),
  },
  (t) => [index('fields_version_idx').on(t.agreementVersionId)],
)

export const signatures = pgTable('signatures', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id')
    .notNull()
    .references(() => recipients.id),
  agreementVersionId: uuid('agreement_version_id')
    .notNull()
    .references(() => agreementVersions.id),
  fieldId: uuid('field_id').references(() => fields.id),
  /** Storage key for the signature image. Never a data URL in the row. */
  imageKey: text('image_key').notNull(),
  method: text('method').notNull(),
  consentText: text('consent_text').notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Email/SMS only. WhatsApp is a share, so it never produces a Delivery. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => agreements.id),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id),
    channel: deliveryChannel('channel').notNull(),
    provider: text('provider').notNull(),
    /** InforU RequestId. */
    providerMessageId: text('provider_message_id'),
    status: deliveryStatus('status').default('queued').notNull(),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('deliveries_agreement_idx').on(t.agreementId)],
)

/**
 * Append-only. Nothing in the application updates or deletes a row here.
 * Metadata is deliberately narrow: never an OTP, a token, or a signature image.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => agreements.id),
    recipientId: uuid('recipient_id').references(() => recipients.id),
    type: text('type').notNull(),
    actor: text('actor').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('audit_agreement_idx').on(t.agreementId, t.createdAt)],
)


/**
 * XTRA AI conversations.
 *
 * Kept per user rather than per organization: a colleague's half-finished
 * instruction to send eighty agreements is not something to hand to someone
 * else, even inside the same company.
 */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Taken from the first thing asked, and renameable. */
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('ai_conversations_user_idx').on(t.userId, t.updatedAt)],
)

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id),
    /** 'user' | 'assistant'. Tool traffic lives in ai_actions, not here. */
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt)],
)

/**
 * Every tool the assistant ran, and what came of it.
 *
 * This is the audit trail for work done through the assistant, and the record
 * a confirmation is checked against: an approval names one action id and one
 * payload hash, so saying "yes" cannot authorise a different send than the one
 * that was shown.
 */
export const aiActions = pgTable(
  'ai_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id),
    messageId: uuid('message_id').references(() => aiMessages.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** The person the assistant acted for. They own the consequences. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    toolName: text('tool_name').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** Human-readable, and free of anything secret. */
    inputSummary: text('input_summary'),
    resultSummary: text('result_summary'),
    /** 'pending' | 'ok' | 'failed' | 'rejected' */
    status: text('status').notNull().default('pending'),
    /** 'not_required' | 'awaiting' | 'approved' | 'declined' | 'expired' */
    approvalStatus: text('approval_status').notNull().default('not_required'),
    /**
     * SHA-256 of the exact arguments shown to the user. An approval that does
     * not match this hash is refused, so a stale "yes" cannot be replayed
     * against different arguments.
     */
    payloadHash: text('payload_hash'),
    payload: jsonb('payload'),
    approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ai_actions_conversation_idx').on(t.conversationId, t.createdAt),
    index('ai_actions_org_idx').on(t.organizationId, t.createdAt),
  ],
)
