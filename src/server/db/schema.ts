import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
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
    /** Soft delete: agreements keep pointing at the company they were filed under. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('companies_org_kind_idx').on(t.organizationId, t.kind)],
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
    pageCount: integer('page_count'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** Soft: agreements keep pointing at the template they were made from. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('templates_org_idx').on(t.organizationId)],
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
