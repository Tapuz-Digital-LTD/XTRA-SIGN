import {
  boolean,
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

export const deliveryChannel = pgEnum('delivery_channel', ['email', 'sms'])

export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sent', 'failed'])

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    isAdmin: boolean('is_admin').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
)

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    /** Builder blocks, or null when the template wraps an uploaded file. */
    content: jsonb('content'),
    sourceFileKey: text('source_file_key'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
    /** Fractions of page width/height — resolution-independent placement. */
    x: text('x').notNull(),
    y: text('y').notNull(),
    width: text('width').notNull(),
    height: text('height').notNull(),
    options: jsonb('options'),
    value: text('value'),
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
