# Tourism 2026 — Self-Service Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, fully automatic flow for the Ministry of Tourism campaign: call-for-suppliers page → one HTML page with details + legal text + signature + inline OTP → thank-you with the signed original PDF, with XTRA Sign doing supplier/project/agreement/audit work behind the scenes and no staff action.

**Architecture:** A new project mode, "הרשמה וחתימה עצמאית", configured in Project Settings (template, owner, skin, TTL, thank-you copy, notify emails) and stored in `groups.landing_config.selfService`. A service `src/server/self-service/onboarding.ts` composes the existing engine (companies, groups, templates, send-agreement, signing/OTP, complete) in a new order. The branded pages live under `src/app/tourism-2026/*` and call one public register route plus the existing `/api/sign/[token]/*` routes. The Ministry PDF is the legal source: its AcroForm rectangles become XTRA fields, the form is flattened at intake, values and signature are stamped by the existing engine.

**Tech Stack:** Next 16 App Router, React 19, Drizzle + Postgres (Neon prod, PGlite tests), pdf-lib, Vercel Blob, InforU SMS/Email, Tailwind 4, vitest, puppeteer-core + sharp for visual QA.

## Global Constraints

- Branch `feat/tourism-2026-onboarding` only. No push to main, no merge of `feat/tourism-2026-landing`, no PR until the user reviews the preview.
- Migrations are additive only and run manually per environment (`scripts/migrate.ts`); never in the production build.
- Legal copy of the agreement is verbatim from `.design/tourism-2026/agreement.pdf`. Never rewritten.
- Page 1 design source of truth: `.design/tourism-2026/artwork.jpeg` (1600×1600). Branded typography that has no font stays artwork crops. No AI-generated replacement images.
- Public pages carry campaign branding only: no XTRA Sign shell, nav, or header.
- Project name in XTRA Sign: `חודש התיירות הישראלית 2026`. Existing prod project "שבוע התיירות 2026" (if any) is neither reused nor renamed before cleanup.
- Form fields, exactly: שם העסק / החברה · ח.פ. / ע.מ. · שם מלא של מורשה החתימה · תפקיד · טלפון נייד · אימייל. All required. No benefit, address, region or category fields.
- OTP stays exactly as XTRA Sign today (SMS to the entered mobile). Two SMS (link + OTP) are accepted.
- Supplier matching: taxId → phone → email against local `companies` (includes CRM-synced rows); name is a signal only; never overwrite an existing company; no live Fireberry query; no Fireberry writes.
- Same supplier again: identical details → same open agreement + fresh link; different details → cancel open one, create new; already signed → "ההרשמה שלכם כבר הושלמה וההסכם נחתם", download link sent to the contact on file.
- Owner of auto-created agreements: the admin user `tomer@xtra.co.il` (configured per project, default = current user when enabling).
- SMS copy: `שלום {שם}, תודה שהצטרפתם לחודש התיירות הישראלית 2026. לחתימה על הסכם ההשתתפות: {קישור}`. Email subject: `הסכם השתתפות – חודש התיירות הישראלית 2026`; body: greeting, "תודה על הצטרפותכם לחודש התיירות הישראלית 2026.", "להשלמת ההצטרפות יש לצפות ולחתום על הסכם ההשתתפות.", CTA "לצפייה וחתימה". Senders from existing env.
- Signing link TTL 30 days (configurable per project). Expired: "תוקף הקישור הסתיים. ניתן לפנות לצוות הפרויקט לקבלת קישור חדש."
- Notifications go through existing org prefs + project `notify_emails`: registration (new_lead), send_failed, signed immediate; unsigned/expiring stay in the digest.
- Preview must never write to the production DB. Production cleanup only after inventory → backup → verified restore → dry-run → explicit approval.
- No hardcoded project ids. Business config lives in Project Settings; design lives in code.

---

## File map

| File | Responsibility |
|---|---|
| `src/server/http/public-url.ts` | `publicBaseUrl()` — SIGN_PUBLIC_URL, else preview branch URL, else localhost |
| `src/server/http/csrf.ts` | `allowedOrigins()` also trusts the Vercel preview origin |
| `src/server/documents/acroform.ts` | Read AcroForm text widgets → `PlacedField[]`; flatten |
| `src/server/documents/process-document.ts` | On intake: flatten fillable PDFs into the rendered file, seed fields |
| `src/lib/fields.ts`, `src/server/documents/save-fields.ts` | `variableKey` survives a save when supplied |
| `src/server/templates/templates.ts` | `createTemplateFromPdf()` |
| `src/app/api/templates/from-pdf/route.ts` | multipart upload → template |
| `src/lib/self-service-skins.ts` | Registry of branded page sets (`tourism-2026`) |
| `src/server/projects/self-service.ts` | Config type, get/save, `findSelfServiceProjectBySkin()` |
| `src/app/api/projects/[id]/self-service/route.ts` | GET/PUT config |
| `src/components/projects/SelfServiceSettings.tsx` | Settings UI section |
| `drizzle/0028_*.sql` | `project_leads.meta`, `project_leads.agreement_id` |
| `src/server/documents/send-agreement.ts` | `issueSigningLink()`, `deliverSigningLink()`, copy + ttl options |
| `src/server/self-service/onboarding.ts` | `startSelfServiceSigning()` — the flow |
| `src/app/api/self-service/[skin]/register/route.ts` | Public register endpoint |
| `src/server/signing/complete.ts` | signer email with return URL, project notify emails, Jerusalem date |
| `src/app/sign/[token]/page.tsx` | Redirect self-service agreements to their skin |
| `src/app/tourism-2026/**` | Page 1, Page 2 (join + resume), Page 3 (thanks), assets, css |
| `scripts/self-service/setup-tourism-2026.ts` | Idempotent environment setup through the services |
| `scripts/design/*.ts` | Pixel diff / responsive shots (ported from the old branch) |

---

### Task 1: Public base URL and preview origins

**Files:**
- Create: `src/server/http/public-url.ts`
- Modify: `src/server/http/csrf.ts` (allowedOrigins), `src/server/documents/send-agreement.ts:106-109`, `src/server/notifications/notifications.ts:43-46`, `src/server/projects/landing.ts:64-68`
- Test: `src/server/http/__tests__/csrf.test.ts`, `src/server/http/__tests__/public-url.test.ts`

**Interfaces:**
- Produces: `publicBaseUrl(): string` (no trailing slash). `allowedOrigins()` includes `https://${VERCEL_BRANCH_URL}` and `https://${VERCEL_URL}` when `VERCEL_ENV === 'preview'`.

- [ ] Write failing tests: `publicBaseUrl()` prefers SIGN_PUBLIC_URL; falls back to `https://<VERCEL_BRANCH_URL>` on preview; localhost otherwise. `allowedOrigins()` on preview includes branch and deployment origins, never on production.
- [ ] Implement; replace the three inline `SIGN_PUBLIC_URL ?? 'http://localhost:3000'` computations with `publicBaseUrl()`.
- [ ] `npm test -- src/server/http` → PASS. Commit `feat(http): one public base URL, trusted on Vercel previews`.

### Task 2: AcroForm intake

**Files:**
- Create: `src/server/documents/acroform.ts`, `src/server/documents/__tests__/acroform.test.ts`, fixture `.design/tourism-2026/agreement.pdf` (committed, the Ministry PDF)
- Modify: `src/lib/fields.ts` (PlacedField gains `variableKey?: string | null`), `src/server/documents/save-fields.ts` (parseField keeps a valid supplied key; loadFields returns it), `src/server/documents/process-document.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AcroFormIntake = { fields: PlacedField[]; flattened: Buffer }
  export async function intakeAcroForm(bytes: Buffer, pages: { page: number; widthPt: number; heightPt: number }[]): Promise<AcroFormIntake | null>
  ```
  Mapping by widget name: contains `signature` → `signature`, signer, box grown to ≥0.055 page height downwards; contains `date` → `date`, signer, `autoFill: true`; contains `email` → `email`; contains `phone` → `phone`; else `text`. All non-signature fields `ownedBy: 'sender'`, `required: true`, `label` = the widget name, `variableKey` = the widget name (lowercased, `[a-z0-9_]`).
- `processDocumentVersion` writes the flattened bytes to a new `rendered` key when an AcroForm exists and seeds `fields` rows if the version has none.

- [ ] Test: intake of the fixture returns 8 fields with the expected keys, fractions (business_name x≈0.507 y≈0.221 w≈0.400 h≈0.020), signature field height ≥0.055, flattened PDF has 0 form fields and the same page size.
- [ ] Test: `processDocumentVersion` on the fixture → version.renderedFileKey ≠ sourceFileKey, fields count 8, renderedHash = sha256(flattened).
- [ ] Implement; run `npm test -- acroform process` → PASS. Commit `feat(documents): fillable PDFs bring their own fields and are flattened at intake`.

### Task 3: Template from PDF

**Files:**
- Modify: `src/server/templates/templates.ts`
- Create: `src/app/api/templates/from-pdf/route.ts`
- Test: `src/server/templates/__tests__/templates.integration.test.ts`

**Interfaces:**
- `createTemplateFromPdf({ session, buffer, name }): Promise<TemplateResult<{ templateId: string; fieldCount: number }>>` — validates bytes (`validateUpload`, PDF only), reads geometry, runs `intakeAcroForm`, stores the (flattened) PDF under `buildTemplateStorageKey`, inserts the template with `fields` and `pageCount`.
- Route: `POST /api/templates/from-pdf` multipart (`file`, `name`), same-origin + session + `upload` rate limit → `{ templateId, fieldCount }`.

- [ ] Test: from the fixture → template with 8 fields, `sourceFileKey` under `org/<org>/templates/`, stored bytes have no AcroForm. Foreign org cannot see it.
- [ ] Implement; PASS; commit `feat(templates): create a template straight from a PDF`.

### Task 4: Self-service project configuration

**Files:**
- Create: `src/lib/self-service-skins.ts`, `src/server/projects/self-service.ts`, `src/app/api/projects/[id]/self-service/route.ts`, `src/components/projects/SelfServiceSettings.tsx`
- Modify: `src/components/projects/ProjectSettings.tsx` (mount the section), `src/app/projects/[id]/page.tsx` (pass config, templates, users), `src/app/join/[slug]/page.tsx` + `src/app/api/join/[slug]/route.ts` + `src/app/api/public/forms/[slug]/submissions/route.ts` (refuse when self-service is enabled: the generic form is not this project's door)
- Test: `src/server/projects/__tests__/self-service.integration.test.ts`

**Interfaces:**
- ```ts
  export const SELF_SERVICE_SKINS = [{ key: 'tourism-2026', label: 'חודש התיירות הישראלית 2026', basePath: '/tourism-2026' }] as const
  export type SelfServiceConfig = {
    enabled: boolean
    skin: SkinKey | null
    templateId: string | null
    ownerUserId: string | null
    linkTtlDays: number            // 1..90, default 30
    thankYouTitle: string          // default 'ההצטרפות הושלמה בהצלחה'
    thankYouText: string           // default ''
  }
  getSelfServiceConfig(session, groupId): Promise<SelfServiceConfig>
  saveSelfServiceConfig(session, groupId, input: Partial<SelfServiceConfig>): Promise<SelfServiceConfig>  // validates template & owner belong to the org
  findSelfServiceProjectBySkin(skin): Promise<SelfServiceProject | null>  // enabled only, not deleted; includes org, group, template, owner, notifyEmails, config
  ```
  Stored as `groups.landing_config.selfService`. Notify emails reuse `groups.notify_emails`.
- UI section "הרשמה וחתימה עצמאית": toggle; skin select; template select + "העלאת הסכם (PDF)" (calls `/api/templates/from-pdf`); owner select (org users); TTL number; thank-you title/text; link to the public page; readiness hints (missing template/owner).

- [ ] Tests: save validates and round-trips; enabling requires template + owner + skin; `findSelfServiceProjectBySkin` ignores disabled/deleted; generic join refuses (404) for a self-service project.
- [ ] Implement server + API + UI. `npm run build` clean. Commit `feat(projects): self-service onboarding settings`.

### Task 5: Registration record columns

**Files:**
- Modify: `src/server/db/schema.ts` (projectLeads: `meta: jsonb('meta')`, `agreementId: uuid('agreement_id')`), `src/server/projects/leads.ts` (status union + `agreementId`), `src/components/projects/LeadsPanel.tsx` (status `converted` label "הומר אוטומטית", link to the agreement)
- Generate: `drizzle/0028_*.sql` via `npm run db:generate` (expect exactly two ADD COLUMN)

- [ ] Generate migration, verify SQL is additive, run tests (PGlite migrates) → PASS. Commit `feat(db): registration meta and agreement link on project leads`.

### Task 6: Split issuing a signing link from delivering it

**Files:**
- Modify: `src/server/documents/send-agreement.ts`
- Test: existing `signing.integration.test.ts` still passes; add a case for custom copy.

**Interfaces:**
- ```ts
  export async function issueSigningLink(input: { session; agreementId; ttlDays?: number; channels: Channel[] }): Promise<{ ok: true; token: string; signingUrl: string; recipient } | { ok: false; blockers: string[] }>
  export type LinkCopy = { sms: (name: string, url: string) => string; email: (name: string, title: string, url: string) => { subject: string; text: string; html: string } }
  export async function deliverSigningLink(input: { agreementId; recipientId; recipientName; phone; email; channels; signingUrl; documentTitle; actor; copy?: LinkCopy }): Promise<Delivery[]>
  export async function mintAdditionalSigningLink(recipientId: string, expiresAt: Date): Promise<{ token: string; signingUrl: string }>
  ```
  `sendAgreement` = issue + deliver with default copy (unchanged behaviour).

- [ ] Refactor, run `npm test -- signing send` → PASS. Commit `refactor(send): issue a link, then deliver it`.

### Task 7: The onboarding service

**Files:**
- Create: `src/server/self-service/onboarding.ts`, `src/server/self-service/__tests__/onboarding.integration.test.ts`

**Interfaces:**
- ```ts
  export type RegistrationInput = {
    skin: SkinKey
    values: { businessName; taxId; signatoryName; signatoryRole; phone; email }  // raw strings
    idempotencyKey: string
    ip: string | null
    referrer: string | null
    meta: Record<string, string>   // whitelisted utm_*, landing_url, form_version
  }
  export type RegistrationResult =
    | { ok: true; kind: 'ready'; token: string; maskedPhone: string; otp: { sent: boolean; devCode?: string } }
    | { ok: true; kind: 'already_signed'; maskedContact: string }
    | { ok: false; message: string; fields?: Record<string, string> }
  export async function startSelfServiceSigning(input: RegistrationInput): Promise<RegistrationResult>
  ```
  Steps, in order: validate (taxId digits 8–9, mobile via `normalizeIsraeliPhone`, email) → load project (`findSelfServiceProjectBySkin`) → system session `{ userId: owner.id, organizationId, email: 'self-service:<skin>', name, isAdmin: true }` → registration row (`project_leads`, status `pending`, unique idempotency key; conflict → replay/wait/takeover after 60s) → `resolveSupplier` (taxId digits / phone last-9 / email lower, kind supplier, not deleted; name-only → new supplier + `notify(new_lead-like duplicate hint)`) → `addCompanies` → open agreement in this project for this supplier (`merge_snapshot->'selfService'->>'projectId'`): same normalized details → reuse; different → `cancelAgreement` → new; signed → `already_signed` (send download link to contact on file via `after`) → `createDocumentFromTemplate` → fill sender fields by `variableKey` (business_name, company_number, contact_phone national format, contact_email, authorized_signatory, signatory_role), `saveFields` → `saveRecipient` → set `merge_snapshot = { selfService: { skin, projectId, registrationId }, values }` → `issueSigningLink(ttl)` → registration row `converted` with company/agreement → `sendOtp` (ignore cooldown on replay) → return; deliver SMS+Email in `after()` (route) with campaign copy, `new_lead` notification "הרשמה חדשה".
- Failure rule: anything after the agreement is committed never deletes it; delivery failures are recorded on `deliveries` + `send_failed` notification.

- [ ] Tests (PGlite, fake storage, log-only notifications): happy path creates supplier, membership, agreement with 8 fields filled, recipient, token, registration converted; replay with same key returns same agreement, no second supplier/agreement; second registration with same taxId different phone format matches supplier; different details cancel and recreate; signed → already_signed; invalid tax/phone/email → field errors; completing the signature stamps values (assert with `pdf-text` helper on the signed PDF).
- [ ] Implement; PASS; commit `feat(self-service): registration to signing in one call`.

### Task 8: Public register route

**Files:**
- Create: `src/app/api/self-service/[skin]/register/route.ts`

- [ ] Body cap 50KB, `leadSubmit` rate limit per IP, honeypot `website`, JSON shape validation, `after()` for deliveries, error shape `{ error: { message, fields } }`. Manual check with curl against dev. Commit.

### Task 9: Signing engine touch points

**Files:**
- Modify: `src/server/signing/complete.ts` (accept `token`, self-service aware signer email with `${skin.basePath}/thanks/${token}`, project notify emails on `signed`, `formatSigningDate` in Asia/Jerusalem), `src/app/api/sign/[token]/complete/route.ts` (pass token), `src/app/sign/[token]/page.tsx` (self-service → `redirect(`${basePath}/sign/${token}`)`)
- Test: signing integration test — date is Israel-local; signer email contains the return URL.

- [ ] Commit `feat(signing): self-service agreements return to their branded pages`.

### Task 10: Page 1 — קול קורא

**Files:**
- Create: `scripts/design/extract-tourism-assets.ts` (sharp crops from `.design/tourism-2026/artwork.jpeg` → `public/tourism-2026/*.webp`), `src/app/tourism-2026/page.tsx`, `src/app/tourism-2026/tourism.css`, `src/app/tourism-2026/layout.tsx` (campaign fonts, metadata, no AppShell), `scripts/design/pixel-diff.ts`, `scripts/design/shots-responsive.ts`
- Assets: logo, headline block (pink script + cyan), section titles (pink script), icons ×6, character (with pink outline), CTA sign, bottom road/arrow art. Body copy and bullet copy are real text in the closest Google Hebrew font measured against the crop (Heebo/Assistant/Rubik/Noto Sans Hebrew), chosen by pixel score.
- Layout: navy `#0c3257` full-bleed, content column max 1600px, composition scaled ≤1600; pink band + road extended to viewport edges with the same colours; mobile (<768) restacks: logo, headline, copy, bullets, character, CTA.
- CTA: `<a href="/tourism-2026/join">` over the sign, focus ring, hover lift, aria-label "מכאן מצטרפים".

- [ ] Extract assets; build; pixel-diff at 1600 vs reference (target: mismatch only in AA/text); shots at 320/375/390/430/768/1024/1440/1920 with no horizontal scroll. Commit.

### Task 11: Page 2 — הצטרפות + הסכם + חתימה

**Files:**
- Create: `src/app/tourism-2026/join/page.tsx`, `src/app/tourism-2026/JoinAndSign.tsx` (client), `src/app/tourism-2026/agreement-text.tsx` (legal copy verbatim from the PDF as RTL HTML), `src/components/signer/SignaturePad.tsx` (canvas extracted from `SignatureSheet`, reused by both), `src/app/tourism-2026/sign/[token]/page.tsx` (resume/expired/signed routing)
- Flow in `JoinAndSign`: details form (6 inputs, ≥44px, `inputmode`/`type` per field, errors under fields) → agreement text → declarations (static ✓ as in the PDF) → signature pad (≥160px tall, clear, consent checkbox with the engine's consent text) → sticky CTA "חתום ושלח" → POST register → OTP panel "שלחנו קוד אימות ל-05X-XXX-XXXX", 6-digit input, resend with cooldown (`/api/sign/[token]/otp`) → verify → `PUT /api/sign/[token]/fields` (no-op) → `POST /api/sign/[token]/complete` with the held signature → `router.replace(`/tourism-2026/thanks/${token}`)`. `already_signed` → message screen. Errors never lose typed data.
- Resume page: token → signed → thanks; not signable → expired screen; else `JoinAndSign` with locked details from `merge_snapshot.values`, and OTP skipped when `hasVerifiedSession`.

- [ ] Real-browser QA at 320/375/390/430/768/1024/1440: no horizontal scroll, keyboard does not hide the CTA, signature with pointer works, OTP dev code path works locally. Commit.

### Task 12: Page 3 — תודה

**Files:**
- Create: `src/app/tourism-2026/thanks/[token]/page.tsx`, `src/app/tourism-2026/ThanksAnimation.tsx`
- Content: campaign logo, animated checkmark (SVG stroke draw) + light confetti in navy/pink/cyan (CSS, `prefers-reduced-motion` → static), title from config (`thankYouTitle`), optional text, button "הורדת ההסכם החתום" → `/api/sign/[token]/download`, line "קישור להורדה נשלח גם למייל" only when the signer email delivery succeeded (read from `deliveries`/audit `email_sent` after completion).
- Token not signed → redirect to resume; unknown/expired → expired screen.

- [ ] QA at the same widths. Commit.

### Task 13: Environment setup through the services

**Files:**
- Create: `scripts/self-service/setup-tourism-2026.ts`
- Idempotent: org's admin `tomer@xtra.co.il` (fallback: first admin) → project `חודש התיירות הישראלית 2026` (find by exact name + not deleted, else create, kind supplier) → template from `.design/tourism-2026/agreement.pdf` named `הסכם השתתפות — חודש התיירות הישראלית 2026` (find by name, else `createTemplateFromPdf`) → `saveSelfServiceConfig` (enabled, skin tourism-2026, template, owner, ttl 30) → prints the public URL. Never touches other projects.

- [ ] Run locally (`npx dotenv-cli -e .env.local -- npx tsx scripts/self-service/setup-tourism-2026.ts`), open `/tourism-2026`, full local E2E with dev OTP code. Commit.

### Task 14: Local QA suite

- [ ] Playwright E2E script (`scripts/qa/tourism-e2e.ts`): Page 1 → join → sign → OTP (dev code) → thanks → download is a PDF containing the typed values (pdf-text) and a signature image; assert DB: supplier, membership, agreement signed, registration converted, audit events.
- [ ] Failure script: double click, replay key, duplicate supplier (formatting variants), invalid tax/phone/email, honeypot, oversized body, rate limit, SMS/email failure (log-only) still redirects, download before signing → 404, expired token screen, cancelled agreement screen.
- [ ] Capacity: 800 registrations in bursts of 40 against dev with notifications stubbed; assert 0 lost, 0 duplicate suppliers/agreements, p95 latency, no pool errors.

### Task 15: Preview environment and deploy

- [ ] Preview DB: separate Neon branch (through the Vercel/Neon integration if reachable from the tools; otherwise the one external action). Preview-scoped env: `DATABASE_URL`(branch), `INFORU_API_URL`, `BASE_CREDENTIALS`, `SIGN_LOG_NOTIFICATIONS=false`, `TRUSTED_PROXY_HOPS`, `SIGN_SMS_SENDER`, `SIGN_EMAIL_SENDER*`, `SIGN_OTP_MESSAGE`. Values copied from the existing local/prod env files via `vercel env add` from stdin — never through chat.
- [ ] Migrate the preview DB, run the setup script against it, push the branch, `vercel deploy` (preview), verify deployment protection allows a phone to open the link, run the real E2E with real SMS/Email.

### Task 16: Production

- [ ] Inventory (read-only) → backup (Neon branch snapshot + `pg_dump` after `brew install libpq`) → restore into a temporary DB and verify counts → cleanup dry-run listing → **stop for explicit approval** → cleanup → migrate 0028 → setup script → verify `/tourism-2026` end to end with a real supplier record the user chooses.
