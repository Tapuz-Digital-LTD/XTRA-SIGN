# Fireberry Templates + Embedded App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Fireberry print templates into XTRA Sign as ordinary PDF templates with mapped merge fields, and make XTRA Sign reachable from inside Fireberry — without a second backend, a second database, or a second UI.

**Architecture:** Fireberry templates are HTML. They are converted to PDF **once, at import**, by headless Chromium running inside the existing Vercel function; from that moment they are ordinary XTRA Sign templates and every existing mechanism (editor, fields, signing, audit) applies unchanged. Fireberry embedding is done by framing pages of the existing Next.js app — the Fireberry app bundle is a thin shell that passes record context in the URL and never holds a credential or an authorization decision.

**Tech Stack:** Next.js 16 App Router · Drizzle + Neon · Vercel Blob (private) · `@sparticuz/chromium` 149 + `puppeteer-core` 25 · pdf-lib + fontkit + bidi-js (unchanged) · pdf.js (unchanged) · `@fireberry/cli` + `@fireberry/sdk`

## Global Constraints

- **PDF-first is preserved.** Nothing outside the import path learns that a template ever was HTML.
- **Snapshot, never live sync.** An imported template never changes because Fireberry changed. New CRM versions are *offered*, never applied.
- **No client-provided identifier is ever an authorization input.** `record.id` / `record.type` from the Fireberry SDK are navigation context only; the server resolves and authorizes from the session.
- **No second data store.** `app.db`, `app.storage` and `record.storage` from the Fireberry SDK are not used.
- **No secrets in code, logs, git, or tool output.** `FIREBERRY_API_TOKEN` stays an environment variable.
- **Backward compatible.** Every schema change is an additive nullable column or a partial index. No column is dropped or retyped.
- **Existing security properties are preserved:** private Blob storage, tenant isolation, Origin-based CSRF checks, OTP hashing, signing-token expiry and revocation, document hashing, rate limiting, immutability of signed documents.
- Hebrew/RTL throughout; mobile-first for anything a signer touches.

## Approved Product Decisions (2026-09-02)

1. **Line-item merge fields stay manual.** No orders/line-items model enters XTRA Sign. `productname`, `itemprice`, `itemquantity`, `totalamount` and friends are **detected, preserved and marked `unmapped`**, are placeable in the editor like any other field, and are filled by the sender before sending. They are never dropped.
2. **Field placement is manual in v1.** No auto-placement, no pdf.js coordinate extraction. The import must be boring and reliable: HTML → PDF once → the operator places fields in the existing editor → saves the template. Everything needed to add auto-placement later is retained (see `crm_source_html_key`), and the stored format does not have to change to add it.
3. **Write-back to Fireberry is allowed, narrowly.** Only when a document was created in the context of a Fireberry Agreement record and has been **signed**: set status = signed, set the signing date, and upload the signed PDF through the existing file-upload path. No other write to Fireberry, ever. Every write is server-side, uses the integration token, is tenant-safe, idempotent, and audited. **XTRA Sign is the source of truth:** a failed write-back never un-signs, alters, or blocks a signed document — it is recorded, surfaced, and retryable.
4. **Admin provisioning only.** A Fireberry user does not get an XTRA Sign account by having Fireberry access or by passing OTP. An XTRA Sign admin creates users and sets roles. No auto-provisioning.

---

# Part I — Design

## 1. Architecture

```
                       ┌────────────────────────────────────────────┐
   Browser ───────────►│                                            │
   (xtra-sign.app)     │   XTRA Sign — Next.js on Vercel            │
                       │   THE only backend, THE only database      │
   Fireberry ─────────►│                                            │
   (iframe of our own  │   Neon Postgres · Vercel Blob (private)    │
    pages, our origin) └────────────────────────────────────────────┘
                                        │
                                        │ server-to-server, token in env
                                        ▼
                             Fireberry REST API (read + file upload)
```

Two access paths, one system. The Fireberry app bundle contains **no business logic, no API token and no data** — it reads `record.id`/`record.type` from the SDK and renders an iframe pointing at our own origin. That single decision removes CORS, removes cross-origin token handling, and keeps every authorization check exactly where it already lives.

## 2. Data flow

**Template import**
```
operator picks a template in /templates
  → server: FireberryProvider.listPrintTemplates()        (object 27, name + modifiedon)
  → server: GET /api/record/27/{id}  → templatebody (HTML)
  → sanitize HTML (strip script/iframe/form/handlers/external CSS)
  → inline every <img> as a data: URI      ← this is what makes it a snapshot
  → render to PDF with Chromium (JS off, network blocked)
  → validateUpload(buffer) → private Blob → templates row
       (crm_template_id, crm_modified_on, crm_content_hash,
        crm_merge_fields, crm_source_html_key, source='crm')
  → the exact HTML that produced this PDF is also stored in private Blob,
    so a future auto-placement pass can re-render it with sentinels
    without changing the stored format (Decision 2)
  → operator opens the existing editor and places fields
```

**Using a template for a company**
```
/templates/[id]/use  (existing route)  or  /embed/company?…
  → copy template PDF + field layout onto a new draft   (existing code path)
  → NEW: fill every sender-owned field whose source_key is set,
         from the company row in OUR database
  → existing send / sign / certificate flow, untouched
```

**Embedded**
```
Fireberry Record Component (their origin)
  → SDK initializeContext() → {record.id, record.type}
  → <iframe src="https://xtra-sign.vercel.app/embed/company
                  ?crmObjectType=1000&crmRecordId=…">
  → our page: requireSession() → if none, OTP login inside the frame
  → server resolves company BY (session.organizationId, crmObjectType, crmRecordId)
       ── not found for THIS org  →  404, identical to "not yours"
```

## 3. Auth flow (embedded)

The Fireberry SDK provides `user.id` and `user.organizationId` as **unsigned client-side values delivered by postMessage**. They are unforgeable-looking and completely forgeable. They are never used for authorization. XTRA Sign authenticates with its own OTP, and the embedded case differs only in cookie attributes.

```
first open inside Fireberry
  → /embed/* renders, no session cookie present in this partition
  → "התחברות ל-XTRA Sign" + phone → OTP → verify        (existing login code)
  → createSession() writes the SAME session row, but the cookie is
        SameSite=None; Secure; Partitioned; HttpOnly
  → CHIPS keys the cookie to (top-level = fireberry, our site),
    so it persists across later visits inside Fireberry → no OTP each time,
    and it is isolated from the standalone site's session.

Safari / Firefox (partitioned cookies restricted)
  → on user gesture call document.requestStorageAccess()
  → if denied: "פתח את XTRA Sign בחלון חדש" with a normal top-level link
```

Why this is safe without SameSite=Lax: mutations are already protected by `assertSameOrigin()` in `src/server/http/csrf.ts`, which checks the `Origin` header against an explicit allow-list and rejects a request that carries neither Origin nor Referer. Because the framed page is served from **our** origin, its requests carry our origin and pass unchanged; a hostile framing site cannot read the frame or forge the header. `SameSite=Lax` was explicitly documented in that file as a second layer, not the defence — this change relies on the primary layer that already exists.

Two cookies, not one: the standalone cookie keeps `SameSite=Lax`. The embedded cookie is a **separate cookie name** with `SameSite=None; Partitioned`, issued only by the embed login route. A stolen embedded cookie therefore cannot be replayed against the standalone site by a cross-site form post, and the standalone site's CSRF posture is untouched.

## 4. HTML → PDF strategy

**Choice: `@sparticuz/chromium` + `puppeteer-core`, inside the existing Vercel function.** No Docker, no separate service, no third party receiving the agreement text.

Checked against the constraints that were set:

| Requirement | How it is met |
|---|---|
| Fits current production | Node runtime on Fluid Compute. `@sparticuz/chromium` ~70 MB unpacked + `puppeteer-core` ~13 MB, far under Vercel's 5 GB function limit. Declared in `serverExternalPackages` so Next does not attempt to bundle the binary. Runs only on the import route, with `memory: 3008, maxDuration: 300` in `vercel.json` — never on the signing path. |
| No heavy extra service | Nothing to operate. The binary ships in the function bundle; no runtime download (that is why `@sparticuz/chromium`, not `-min`). |
| Fidelity of HTML and images | Real Chromium with `printBackground: true`. Fireberry's HTML is a plain subset — verified across all 23 templates: zero `<script>`, `<iframe>`, `<form>`, `<link>`, or event handlers. Tables, inline CSS and images render as the CRM shows them. |
| RTL and Hebrew | `@sparticuz/chromium` ships Open Sans — **Latin, Greek, Cyrillic only, no Hebrew**; left alone, every Hebrew glyph becomes a box. Fix: inject `@font-face` blocks that alias the families the templates actually request (`Arial`, `Helvetica`, `sans-serif`) to the `Assistant-Regular.ttf` already in the repo, embedded as a base64 `data:` URI so the font is part of the document and needs no font path, no Lambda layer and no network. `dir="rtl"` is preserved from the source. |
| Deterministic coordinates | The decisive property is not render reproducibility — it is that **we render exactly once**. The PDF is written to Blob and is thereafter the immutable artefact that fields are placed on. A future Chromium upgrade cannot move a field, because that PDF is never regenerated. Re-importing produces a *new* template, never a mutation of an existing one. Within the single render, layout is pinned: fixed A4 `@page` with fixed margins, `deviceScaleFactor: 1`, all assets inlined, `page.emulateMediaType('print')`, wait on `document.fonts.ready`, and animations disabled. |

Security of the render step — the HTML is third-party content:
- **JavaScript disabled** in the page (`page.setJavaScriptEnabled(false)`).
- **All network blocked** at the request interceptor; every asset is already inlined, so a render needs no fetch. This makes SSRF from template content impossible at render time.
- Asset inlining happens earlier, in our own fetcher, which enforces: `https:` only, DNS resolution rejected for loopback/link-local/private ranges (blocks `169.254.169.254` and friends), a 10 s timeout, a 5 MB per-asset cap, a 25-asset cap, and an image-only content-type check.
- The generated PDF then goes through the **existing** `validateUpload()` magic-byte check and the existing size limits before it is stored.

## 5. Merge-field strategy

76 distinct merge fields exist across the 23 templates, in three shapes: direct (`{[!createdon]}`), lookup display name (`{[!accountidname]}`), and relation traversal (`{[!pcfsuppliers_pcfcity]}`).

**Phase 3 does mapping, not auto-placement.** A merge token becomes a *placeable, auto-fillable field definition*; the operator places it with the editor that already exists and works. Auto-placement by coordinate extraction is deliberately deferred (see Phase 6, and Decision D3).

At import, each `{[!x]}` is replaced in the HTML by a visible blank (a bottom-bordered span of the token's own width) and recorded in `templates.crm_merge_fields` as `{ token, label, suggestedType, sourceKey }`. The editor shows them as one-click chips: "Fireberry: שם ספק · עיר · איש קשר …".

The mapping table lives in one file and is the only place a Fireberry field name appears:

| Fireberry token | `source_key` | Filled from (our DB) |
|---|---|---|
| `pcfsuppliers_pcfsystemfield109`, `accountidname`, `pcfsuppliersname`, `accountid_accountname` | `company.name` | `companies.name` |
| `accountid_idnumber`, `idnumber`, `pcfvatid`, `taxid` | `company.taxId` | `companies.taxId` |
| `pcfsuppliers_pcfsystemfield100`, `pcfsystemfield63_firstname` | `company.contactName` | `companies.contactName` |
| `pcfsuppliers_pcfsystemfield104`, `telephone`, `pcfsystemfield63_telephone1` | `company.contactPhone` | `companies.contactPhone` |
| `pcfsuppliers_pcfsystemfield125`, `emailaddress` | `company.contactEmail` | `companies.contactEmail` |
| `pcfsuppliers_pcfstreet`, `pcfsuppliers_pcfcity`, `org_address`, `address` | `company.address` | `companies.address` |
| `createdon` | `document.date` | today, at send time |
| line-item tokens (`productname`, `itemprice`, `itemquantity`, `description`, `pcfcurrency`, `totalamount`, …) | *unmapped* | see Decision D2 |

Unmapped tokens (`sourceKey: null`) are **not discarded**: they are stored with the rest, shown in the editor under "למילוי ידני", placed like any other field, and become ordinary sender-filled fields that the operator types before sending. This is Decision 1.

Filling happens **server-side at document creation**, reading the company row from our own database by id after the normal authorization check. The Fireberry record id is never the source of the data and never the basis of access.

## 6. Static signature handling

`הסכם ספקים` embeds `signatuere.JPG` — a picture of a signature. Treating that as a digital signature would be a false legal claim, and silently deleting an image that turns out to be a logo would corrupt the document. So: **detect, propose, never auto-delete.**

Detection is a scored heuristic over the *source HTML*, before rendering, over each `<img>`:
- filename matches `/signature|signatuere|sign|חתימה/i` → strong
- nearest preceding or containing text matches `/חתימ|על החתום|ולראיה/` → strong
- appears in the last 25% of the document body → weak
- width between 80 and 400 px → weak

Two strong signals, or one strong plus two weak, marks a **candidate**. Candidates are never removed automatically. The import result screen shows each candidate as a cropped preview with: *"נראה שזו תמונת חתימה סרוקה. להסיר ולהחליף בשדה חתימה של XTRA Sign?"* — with **Keep** as the default. Only on explicit confirmation is the `<img>` replaced, before rendering, by an empty box of identical dimensions, and a `signature` field is suggested at that spot.

## 7. Fireberry Record Component flow (A)

```
Supplier / Customer / Agreement record page in Fireberry
└── XTRA Sign panel  (React bundle hosted by Fireberry, ~100 lines)
      const { record } = client.context            // id + type
      <iframe src={`${XTRA}/embed/company?crmObjectType=${record.type}
                    &crmRecordId=${record.id}`} />
```
Inside the frame — our own page, our own session, our own authorization:
- documents for that company, split into awaiting-signature / signed
- new document, choose template, send for signature
- import documents from Fireberry, import templates from Fireberry

The company is never chosen again by the user: the server looks it up from `(session.organizationId, crmObjectType, crmRecordId)`. If that pair does not resolve within the caller's organization, the answer is 404 — the same answer as "exists but not yours", so the endpoint reveals nothing.

## 8. Global Menu flow (B)

A second component in the same Fireberry app, `חתימות`, whose entire body is an iframe of `https://xtra-sign.vercel.app/?embed=1`. `embed=1` suppresses nothing but the outer chrome duplication (it hides our own top nav's redundant logo row). The full app — documents, templates, suppliers, customers, settings, users — is the same code, the same routes, the same data. No UI is reimplemented for Fireberry.

## 9. Security boundaries

| Boundary | Rule |
|---|---|
| Fireberry SDK context | Navigation hint only. Never an authorization input, never trusted for identity or tenancy. |
| Session | XTRA Sign OTP only. Embedded sessions use a distinct cookie name with `SameSite=None; Secure; Partitioned`. |
| CSRF | Unchanged `assertSameOrigin()` on every mutation. `SIGN_EXTRA_ORIGINS` is not widened for Fireberry — the framed page is our own origin. |
| Framing | `frame-ancestors` moves from `'none'` to an explicit allow-list from `SIGN_FRAME_ANCESTORS`; empty means `'none'`. Never `*`. |
| Template HTML | Sanitized, JS disabled, network blocked at render. |
| Asset fetch | https only, private/loopback/link-local IPs refused, size/count/time capped, image content-types only. |
| Generated PDF | Goes through the existing `validateUpload()` and size limits like any upload. |
| CRM writes | Read-only, except the already-shipped signed-PDF upload. Import never writes to Fireberry. |
| CRM ids | `crm_template_id` is server-assigned from the listing; never accepted from a client. |
| Signed documents | Still immutable. Nothing in this plan touches a signed agreement. |

## 10. Files and modules

**Create**
| Path | Responsibility |
|---|---|
| `src/server/crm/html-sanitize.ts` | Strip scripts/handlers/external CSS from template HTML; extract `<img>` list; replace merge tokens with blanks |
| `src/server/crm/inline-assets.ts` | SSRF-guarded fetch + base64 inlining of images |
| `src/server/crm/html-to-pdf.ts` | Chromium launch, font injection, deterministic print settings, PDF bytes out |
| `src/server/crm/merge-fields.ts` | The token → `source_key` table, plus `detectMergeFields(html)` |
| `src/server/crm/signature-images.ts` | Candidate scoring and removal |
| `src/server/crm/import-templates.ts` | `listCrmTemplates()` / `importCrmTemplates()` — orchestration, versioning, audit |
| `src/server/documents/autofill.ts` | Fill sender fields from a company at document creation |
| `src/app/api/crm/templates/route.ts` | List + import endpoints |
| `src/app/embed/layout.tsx`, `src/app/embed/company/page.tsx` | Embedded surfaces |
| `src/server/auth/embed-session.ts` | Partitioned-cookie session issue/read |
| `src/components/crm/CrmTemplateImport.tsx` | Import modal (mirrors `CrmDocumentImport.tsx`) |
| `fireberry-app/` | Fireberry app: manifest + two components |

**Modify**
| Path | Change |
|---|---|
| `src/server/db/schema.ts` | Additive nullable columns + one partial unique index (§11) |
| `src/server/crm/fireberry.ts` | `listPrintTemplates()`, `getPrintTemplate(id)` |
| `src/lib/content-security-policy.ts` | `frame-ancestors` from env |
| `src/server/auth/session.ts` | Recognise both cookie names on read |
| `src/server/templates/templates.ts` | `createDocumentFromTemplate` gains optional `companyId`; carries `source_key` through the template→document copy |
| `src/server/documents/save-fields.ts` | Persist/validate `sourceKey` |
| `src/lib/fields.ts` | `sourceKey: string \| null` on `PlacedField` |
| `src/components/editor/FieldPanel.tsx` | Fireberry field chips |
| `next.config.ts` | `serverExternalPackages`, tracing includes for the font |
| `vercel.json` | Memory/duration for the import route |

## 11. Schema changes (all additive — stop-and-explain point)

```sql
ALTER TABLE templates ADD COLUMN crm_template_id     text;
ALTER TABLE templates ADD COLUMN crm_modified_on     text;
ALTER TABLE templates ADD COLUMN crm_content_hash    text;
ALTER TABLE templates ADD COLUMN crm_merge_fields    jsonb;
ALTER TABLE templates ADD COLUMN crm_source_html_key text;
ALTER TABLE templates ADD COLUMN source              text;   -- 'crm' | null

-- Identity of an imported template is (which CRM template, which CONTENT).
-- Same template, changed content  -> different hash -> a NEW row is allowed.
-- Same template, same content     -> same hash      -> refused as a duplicate.
CREATE UNIQUE INDEX templates_crm_version_unique
  ON templates (organization_id, crm_template_id, crm_content_hash)
  WHERE crm_template_id IS NOT NULL;

ALTER TABLE fields ADD COLUMN source_key text;               -- 'company.name' etc.
```
Seven nullable columns and one partial unique index. No column is dropped, renamed or retyped; every existing row and code path is valid unchanged.

### Versioning model

The unique key is **`(organization_id, crm_template_id, crm_content_hash)`**, not `(organization_id, crm_template_id)`. That one change is what makes versioning real:

| Situation | Result |
|---|---|
| Import a template for the first time | New row |
| Import the same template again, content unchanged | Same hash → index refuses → reported as "כבר יובא", nothing written |
| Fireberry template edited, then imported | Different hash → **a new, separate template row** |
| An older imported version | Untouched, forever. Its PDF, its fields and every document made from it are unaffected |

`crm_content_hash` is SHA-256 of the raw `templatebody` **as fetched**, computed before sanitizing or inlining, so the identity is the CRM's content and not an artefact of our pipeline.

**A template row is immutable once written.** Nothing in the import path ever UPDATEs an existing template — not its PDF, not its fields, not its bookkeeping columns. "Offered, never applied" is enforced by the absence of an update statement, not by convention.

**Provenance** is fully recoverable per template: `crm_template_id` (which Fireberry template), `crm_content_hash` (which content), `crm_modified_on` (the CRM's own timestamp for that version), `created_at` (when we took the snapshot). Version ordering within one `crm_template_id` is `created_at ASC`; the UI numbers them "גרסה 1, 2, 3…" from that, with no stored counter to drift.

**"A new version exists in Fireberry"** is a two-stage check, because `templatebody` is not returned by the bulk query and fetching 23 bodies to render a badge would be wasteful:
1. *Cheap, on the listing:* the CRM's current `modifiedon` (from `/api/query`) is newer than the newest `crm_modified_on` we hold for that `crm_template_id` → show "קיימת גרסה חדשה ב-Fireberry".
2. *Exact, on import:* fetch the body, hash it. If the hash matches a version we already hold, nothing is written and the user is told "התוכן זהה לגרסה שכבר יובאה — לא נוצרה גרסה חדשה."

Stage 1 can therefore produce a false positive when someone opens and re-saves a template in Fireberry without changing anything. That is deliberate: the alternative is either mutating an imported row (which breaks immutability) or fetching every body on every listing. The false positive costs one click and is answered honestly at stage 2.

---

# Part II — Phases

Each phase ends with something that works and can be judged on its own.

## Phase 1 — HTML → PDF conversion (no UI)

**Files:** create `src/server/crm/html-sanitize.ts`, `inline-assets.ts`, `html-to-pdf.ts`; modify `next.config.ts`, `vercel.json`, `package.json`. Tests in `src/server/crm/__tests__/`.

**Interfaces produced:**
```ts
sanitizeTemplateHtml(html: string): { html: string; images: { src: string; index: number }[] }
inlineAssets(html: string): Promise<{ html: string; failed: string[] }>
renderHtmlToPdf(html: string): Promise<Buffer>
```

- [ ] **Step 1: Install and pin**
```bash
npm i @sparticuz/chromium@149 puppeteer-core@25
```
- [ ] **Step 2: Failing test for the sanitizer**
```ts
it('removes script, handlers and external stylesheets but keeps tables and inline style', () => {
  const { html } = sanitizeTemplateHtml(
    `<link rel="stylesheet" href="http://x/a.css"><script>alert(1)</script>` +
    `<div onclick="evil()" style="color:red"><table><tr><td>שלום</td></tr></table></div>`)
  expect(html).not.toMatch(/<script|onclick|<link/i)
  expect(html).toContain('<table>')
  expect(html).toContain('color:red')
  expect(html).toContain('שלום')
})
```
- [ ] **Step 3: Run it, confirm it fails** — `npx vitest run src/server/crm` → FAIL, not a function.
- [ ] **Step 4: Implement the sanitizer** (allow-list of tags/attributes; collect `<img src>` with index).
- [ ] **Step 5: Tests pass.**
- [ ] **Step 6: Failing test for the SSRF guard**
```ts
it.each(['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:5432/', 'http://10.0.0.5/logo.png'])(
  'refuses %s', async (url) => {
    const { html, failed } = await inlineAssets(`<img src="${url}">`)
    expect(failed).toHaveLength(1)
    expect(html).not.toContain('data:image')
  })
it('refuses non-https', async () => {
  expect((await inlineAssets('<img src="ftp://x/a.png">')).failed).toHaveLength(1)
})
```
- [ ] **Step 7: Implement `inlineAssets`** — resolve DNS, reject non-public addresses, https only, 10 s timeout, 5 MB/asset, 25 assets, image content-type only; on failure leave the `<img>` out and report it.
- [ ] **Step 8: Tests pass. Commit.**
- [ ] **Step 9: Hebrew rendering test (the one that catches the tofu bug)**
```ts
it('renders Hebrew as real glyphs, not boxes', async () => {
  const pdf = await renderHtmlToPdf('<div dir="rtl" style="font-family:Arial">הסכם ספקים</div>')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const text = await extractPdfText(pdf)           // helper added in Step 9a
  expect(text).toContain('הסכם ספקים')
})
```
- [ ] **Step 9a: Add the test helper this assertion needs** — `src/server/crm/__tests__/pdf-text.ts`, using the `pdfjs-dist` legacy build already in the project:
```ts
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
export async function extractPdfText(pdf: Buffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise
  let out = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    out += content.items.map((i) => ('str' in i ? i.str : '')).join('')
  }
  return out
}
```
There is no existing extraction helper — `src/server/signing/pdf-text.ts` does bidi shaping, not extraction.

- [ ] **Step 10: Implement `renderHtmlToPdf`** — launch with `chromium.args`, `setJavaScriptEnabled(false)`, block every request, inject the `@font-face` aliases for Arial/Helvetica/sans-serif from the base64 `Assistant-Regular.ttf`, `emulateMediaType('print')`, await `document.fonts.ready`, `page.pdf({ format:'A4', printBackground:true, margin:'12mm' })`. Always `browser.close()` in `finally`.
- [ ] **Step 11: Config** — `serverExternalPackages: ['@sparticuz/chromium','puppeteer-core']` in `next.config.ts`; `outputFileTracingIncludes` for the font on the new route; `vercel.json` entry `memory: 3008, maxDuration: 300`.
- [ ] **Step 12: Full suite + build + commit.**

## Phase 2 — Import a template from Fireberry

**Files:** create `src/server/crm/import-templates.ts`, `src/app/api/crm/templates/route.ts`, `src/components/crm/CrmTemplateImport.tsx`; modify `src/server/crm/fireberry.ts`, `src/server/db/schema.ts`, `src/app/templates/page.tsx`.

**Interfaces produced:**
```ts
listPrintTemplates(): Promise<{ id: string; name: string; modifiedOn: string | null; boundObject: string | null }[]>
getPrintTemplate(id: string): Promise<{ id: string; name: string; body: string; modifiedOn: string | null }>
listCrmTemplates(s: StaffSession): Promise<ListResult>
importCrmTemplates(i: { session; templateIds: string[] }): Promise<ImportResult>
```

- [ ] **Step 1: Migration** — the seven `templates` columns and the `templates_crm_version_unique` partial index from §11. Generate with `npm run db:generate`, review the SQL, apply with `npm run db:migrate`.
- [ ] **Step 2: Failing test — provider reads object 27** (against a stubbed fetch; the live shape is already known: `data.Record.templatebody`).
- [ ] **Step 3: Implement `listPrintTemplates` / `getPrintTemplate`.** Note `templatebody` is **not** returned by `/api/query` — the list comes from query, the body from `GET /api/record/27/{id}`.
- [ ] **Step 4: Failing test — dedup**
```ts
it('refuses an unchanged re-import but creates a new version when the CRM body changed', async () => {
  await importCrmTemplates({ session, templateIds: ['t1'] })
  const again = await importCrmTemplates({ session, templateIds: ['t1'] })
  expect(again).toMatchObject({ ok: true, imported: 0, skipped: 1 })

  crmBodyBecomes('t1', '<p>נוסח חדש</p>')
  const v2 = await importCrmTemplates({ session, templateIds: ['t1'] })
  expect(v2).toMatchObject({ ok: true, imported: 1 })

  const versions = await templateVersions(session, 't1')
  expect(versions).toHaveLength(2)
  expect(versions[0].sourceFileKey).not.toBe(versions[1].sourceFileKey)  // v1 untouched
})
```
- [ ] **Step 5: Implement `importCrmTemplates`** — sanitize → inline → render → `validateUpload` → `buildTemplateStorageKey` → private Blob → insert `templates` row with `crm_template_id`, `crm_modified_on`, `crm_content_hash`, `crm_merge_fields`, `crm_source_html_key`, `source:'crm'` → audit event. The hash is taken on the **raw** body before sanitizing. Never UPDATE an existing template row. Per-file failures are reported by name, as the document import already does.
- [ ] **Step 6: Test that a template is a plain template** — a document created from an imported template has a copied PDF and no link back to Fireberry.
- [ ] **Step 7: UI** — "ייבוא תבניות מ-Fireberry" on `/templates`, modal listing name + bound object + last modified, "כבר יובא" badge, `מקור: Fireberry` badge on the row.
- [ ] **Step 8: Suite, build, lint, commit, deploy, verify in production on a real template.**

## Phase 3 — Merge-field mapping and auto-fill

**Files:** create `src/server/crm/merge-fields.ts`, `src/server/documents/autofill.ts`; modify `src/lib/fields.ts`, `src/server/documents/save-fields.ts`, `src/server/templates/templates.ts`, `src/components/editor/FieldPanel.tsx`, schema.

- [ ] **Step 1: Migration** — `ALTER TABLE fields ADD COLUMN source_key text;`
- [ ] **Step 2: Failing test — token detection and mapping**
```ts
it('maps supplier tokens to company keys and leaves line items unmapped', () => {
  const found = detectMergeFields('<p>{[!pcfsuppliers_pcfstreet]} {[!itemprice]}</p>')
  expect(found).toEqual([
    { token: 'pcfsuppliers_pcfstreet', sourceKey: 'company.address', label: 'כתובת', suggestedType: 'text' },
    { token: 'itemprice', sourceKey: null, label: 'itemprice', suggestedType: 'text' },
  ])
})
```
- [ ] **Step 3: Implement `merge-fields.ts`** — the table from §5 plus `detectMergeFields`.
- [ ] **Step 4: Failing test — auto-fill is server-side and tenant-safe**
```ts
it('fills sender fields from the company and ignores a foreign company id', async () => {
  const doc = await createDocumentFromTemplate({ session, templateId, companyId: mine })
  expect(await valueOf(doc, 'company.name')).toBe('גבינות ברמות')
  const foreign = await createDocumentFromTemplate({ session, templateId, companyId: otherOrgCompany })
  expect(foreign).toMatchObject({ ok: false })
})
```
- [ ] **Step 5: Implement `fillFromCompany`** and call it from `createDocumentFromTemplate` in `src/server/templates/templates.ts`, whose signature gains an **optional** `companyId?: string` (existing callers keep working; `src/app/api/templates/[id]/use/route.ts` passes it through). Signer-owned fields are never pre-filled.
- [ ] **Step 6: Editor chips** — imported templates show their Fireberry fields as one-click placements carrying `sourceKey`.
- [ ] **Step 7: Suite, build, commit.**

## Phase 4 — Static signature images

**Files:** create `src/server/crm/signature-images.ts`; modify `import-templates.ts` and the import modal.

- [ ] **Step 1: Failing tests for the scorer** — `signatuere.JPG` near "ולראיה באו הצדדים על החתום" is a candidate; `logo.JPG` in the header is not; a 1200 px banner is not.
- [ ] **Step 2: Implement the scorer** exactly as scored in §6.
- [ ] **Step 3: Test that nothing is removed without confirmation** — importing with no confirmation keeps every `<img>`.
- [ ] **Step 4: UI** — candidates listed with previews, Keep is preselected; on confirm the image is replaced by an empty box of the same size and a `signature` field is suggested there.
- [ ] **Step 5: Suite, commit, verify on `הסכם ספקים` in production.**

## Phase 5 — Embedded session and framing

**Files:** create `src/server/auth/embed-session.ts`, `src/app/embed/layout.tsx`, `src/app/embed/company/page.tsx`; modify `src/lib/content-security-policy.ts`, `src/server/auth/session.ts`.

- [ ] **Step 1: Failing test — CSP allow-list**
```ts
it('frames nowhere by default and only the configured origin when set', () => {
  expect(buildCsp({ isProd: true, frameAncestors: [] })).toContain("frame-ancestors 'none'")
  expect(buildCsp({ isProd: true, frameAncestors: ['https://app.fireberry.com'] }))
    .toContain("frame-ancestors https://app.fireberry.com")
  expect(buildCsp({ isProd: true, frameAncestors: ['*'] })).toContain("frame-ancestors 'none'")
})
```
- [ ] **Step 2: Implement** — read `SIGN_FRAME_ANCESTORS`, accept only absolute https origins, drop anything else.
- [ ] **Step 3: Failing test — embedded cookie attributes**
```ts
it('issues a partitioned cross-site cookie only for the embed flow', async () => {
  const c = await createEmbedSession(userId)
  expect(c).toMatchObject({ sameSite: 'none', secure: true, partitioned: true, httpOnly: true })
  expect(c.name).not.toBe(SESSION_COOKIE)
})
```
- [ ] **Step 4: Implement `embed-session.ts`**; `getSession()` reads either cookie, same session table, same expiry.
- [ ] **Step 5: Failing test — record context is not authorization**
```ts
it('404s when the CRM record belongs to another organization', async () => {
  await expect(resolveEmbeddedCompany(session, { crmObjectType: 1000, crmRecordId: foreignId }))
    .resolves.toBeNull()
})
```
- [ ] **Step 6: Implement `/embed/company`** — resolve by `(session.organizationId, crmObjectType, crmRecordId)`; show the company's documents and actions; login inside the frame when there is no session; Storage-Access fallback with a "open in a new window" link.
- [ ] **Step 7: Suite, build, deploy; verify framing works from a scratch HTML page on an allow-listed origin and is refused from any other.**

## Phase 6 — Fireberry app (Record Component + Global Menu)

**Files:** create `fireberry-app/` via `fireberry create`.

- [ ] **Step 1: Scaffold** — `fireberry create xtra-sign` then `create-component` for a Record component and a Global Menu component.
- [ ] **Step 2: Record component** — `initializeContext()`, then an iframe to `/embed/company` with `crmObjectType`/`crmRecordId`. No token, no API call, no business logic.
- [ ] **Step 3: Global Menu component** — iframe to `/?embed=1`.
- [ ] **Step 4: Local debug** — `fireberry_apps_debug_start` against `localhost:3000`, confirm context arrives and the frame loads.
- [ ] **Step 5: Set `SIGN_FRAME_ANCESTORS`** to the real Fireberry app origin observed in step 4.
- [ ] **Step 6: `fireberry push` + `install`; verify on a real supplier record; confirm the OTP is asked once and not again on a later visit.**

## Phase 7 — Signed-document write-back to a Fireberry Agreement

Approved by Decision 3, and deliberately last: it depends on the embed flow to know which Fireberry Agreement record a document belongs to.

**Files:** create `src/server/crm/writeback.ts`, `src/app/api/crm/writeback/retry/route.ts`; modify `src/server/db/schema.ts`, `src/server/signing/complete.ts`, `src/app/documents/[id]/page.tsx`.

**Schema (additive, nullable — a second stop-and-explain point):**
```sql
ALTER TABLE agreements ADD COLUMN crm_record_object_type integer;  -- 1006 etc.
ALTER TABLE agreements ADD COLUMN crm_record_id          text;     -- the Agreement record
ALTER TABLE agreements ADD COLUMN crm_writeback_state    text;     -- pending|done|failed
ALTER TABLE agreements ADD COLUMN crm_writeback_at       timestamptz;
ALTER TABLE agreements ADD COLUMN crm_writeback_error    text;
```

**Interfaces produced:**
```ts
writeBackSignedAgreement(agreementId: string): Promise<{ ok: true } | { ok: false; error: string }>
```

- [ ] **Step 1: Failing test — signing never depends on the CRM**
```ts
it('keeps the document signed when the CRM write fails', async () => {
  crmFails()
  await completeSigning({ token })
  const doc = await getDocumentDetail(agreementId)
  expect(doc.status).toBe('signed')                       // unchanged
  expect(doc.crmWritebackState).toBe('failed')            // recorded, visible
})
```
- [ ] **Step 2: Failing test — idempotent**
```ts
it('does not write twice for the same agreement', async () => {
  await writeBackSignedAgreement(id)
  await writeBackSignedAgreement(id)
  expect(crmCalls()).toHaveLength(1)                      // second is a no-op on state 'done'
})
```
- [ ] **Step 3: Failing test — refuses anything but a signed document in this org**
```ts
it('refuses an unsigned document and a foreign organization', async () => {
  await expect(writeBackSignedAgreement(draftId)).resolves.toMatchObject({ ok: false })
  await expect(writeBackSignedAgreement(foreignOrgId)).resolves.toMatchObject({ ok: false })
})
```
- [ ] **Step 4: Implement `writeBackSignedAgreement`** — re-read the agreement server-side; require `status === 'signed'` and a stored `crm_record_id`; skip when state is already `done`; update the CRM record's status + signing date; upload the clean signed PDF through the existing `uploadAgreement` path; set state and write an audit row. Every failure path sets `failed` + `crm_writeback_error` and returns `{ ok:false }` — it never throws into the signing flow.
- [ ] **Step 5: Call it from `complete.ts` after the signature is durably committed**, in a `.catch()` that cannot affect the signing result.
- [ ] **Step 6: Surface and retry** — the document page shows "העדכון ל-Fireberry נכשל" with a retry button on the new route; the route is admin-only, rate-limited and CSRF-checked like every other mutation.
- [ ] **Step 7: Suite, build, commit.**

## Phase 8 — Rollout

- [ ] **Step 1:** Deploy Phases 1–4 (template import). They touch no existing behaviour: new columns, new route, new UI entry point.
- [ ] **Step 2:** Verify in production on `הסכם ספקים`: import → PDF renders with correct Hebrew → place fields → send → sign on a phone → signed PDF and certificate correct.
- [ ] **Step 3:** Deploy Phase 5 with `SIGN_FRAME_ANCESTORS` **unset** — behaviour identical to today (`frame-ancestors 'none'`), embed routes reachable only top-level. Confirm the standalone app is unchanged.
- [ ] **Step 4:** Set `SIGN_FRAME_ANCESTORS`, install the Fireberry app for one pilot user, run both flows.
- [ ] **Step 5:** Replace the personal API token with the `XTRA Sign Integration` user's token.
- [ ] **Step 6:** Roll out to the rest of the team.
- [ ] **Step 7:** Enable Phase 7 write-back last, after a signed test document has been verified end to end.

**Rollback:** each phase is independently revertible. Unsetting `SIGN_FRAME_ANCESTORS` disables all framing without a deploy. Uninstalling the Fireberry app leaves XTRA Sign untouched. Imported templates are ordinary templates and survive any rollback of the import code.

## Tests summary

| Area | Test |
|---|---|
| Sanitizer | script/handler/link removed; tables, inline CSS, Hebrew kept |
| SSRF | metadata IP, loopback, private range, non-https all refused |
| Render | Hebrew extracts as text, not boxes; output is a valid PDF |
| Import | duplicate refused by content hash; per-item failure reporting; audit row written |
| Snapshot | changing the CRM body does not alter an imported template |
| Merge fields | token → `source_key` mapping; unmapped tokens stay unmapped |
| Auto-fill | sender fields filled from our DB; foreign company id rejected; signer fields never pre-filled |
| Signature images | scorer positives and negatives; nothing removed without confirmation |
| CSP | default `'none'`; allow-list honoured; `*` rejected |
| Embed session | partitioned attributes; distinct cookie name; both cookies readable |
| Authorization | foreign-org CRM record resolves to 404 |
| Versioning | unchanged content refused as duplicate; changed content creates a second row; the first row is byte-identical afterwards |
| Write-back | signing survives a CRM failure; idempotent; unsigned and foreign-org refused; audit row written |
| Regression | full existing suite (198 tests) green throughout |

---

# Addendum (2026-09-02) — Four document sources, and why 3 and 4 are not the same thing

## The distinction that drives the model

**A template is a blueprint. An existing Fireberry business document is already an instance.**
Merging a blank template against a record is the wrong operation for the second: order 1758 already
*has* its customer, its date, its number, its line items and its totals. Re-deriving them would be
re-computing something that already exists, and would silently disagree with the CRM the moment any
rule differed.

| # | Source | Blueprint? | Creates a `templates` row? | Data comes from |
|---|---|---|---|---|
| 1 | From scratch (XTRA Sign composer) | — | no | the author |
| 2 | XTRA Sign template | yes | reuses one | the author, plus company fields |
| 3 | Fireberry **template** (object 27) | yes | yes, on import | merge against the chosen company's CRM record |
| 4 | Fireberry **business document** (an order/quote, e.g. 1758) | **no** | **never** | the record itself, as it already stands |

Flow 4 must not pass through the templates table at all. That is the architectural lock-in being
avoided: "everything from Fireberry is a template" is false.

## Discovery results

**Line items are a real collection, not a scalar token.** Object 17 (`CrmOrderItem`) carries
`productname` (מוצר/שירות), `description` (תיאור), `itemquantity` (כמות), `itemprice`
(מחיר ליחידה), `itemtotalprice` (סכום), `tax` (מע״מ), `pcfcurrency` (מטבע/אחוז),
`catalognumber` (מק״ט), `itemorder` (סדר — the row order) and `crmorderid` (the parent). Verified on
order 1758: 11,000 ₪, 2024-03-07, one item "אתר בחירת מתנות" qty 55 × 200.

This also explains the tokens in `הסכם ספקים` that were not fields of object 13 — `itemprice`,
`pcfcurrency`, `productname` are **object 17** fields, i.e. cells of a repeating row.

**Token meanings, read from Fireberry metadata rather than guessed:**

| token | object | actual meaning |
|---|---|---|
| `createdon` | 13 | נוצר בתאריך — the *order's* creation date. **Not "today".** |
| `accountidname` | 13 | לקוח (display name of the customer lookup) |
| `pcfsystemfield104` (on 13) | 13 | שם חברה |
| `pcfsuppliers_pcfsystemfield109` | 1000 | שם החברה הרשמי |
| `pcfsuppliers_pcfstreet` | 1000 | כתובת |
| `pcfsuppliers_pcfcity` | 1000 | עיר |
| `pcfsuppliers_pcfsystemfield100` | 1000 | **שם פרטי** |
| `pcfsuppliers_pcfsystemfield101` | 1000 | **שם משפחה** |
| `pcfsuppliers_pcfsystemfield104` | 1000 | טלפון נייד |

A hand-written mapping would have got several of these wrong — `…field100` reads like "contact name"
and is actually a first name. **Resolution is by Fireberry field name against the linked object's
metadata; a hand-written table is only a fallback for what metadata cannot answer.**

**Can Fireberry hand us the rendered document? No supported way was found.**
- Not in the public API reference (only file upload/list/download).
- Not in either official MCP server.
- The order does declare `printtemplateid` (1758 → "הצעת מחיר"), so the CRM knows which template
  renders it — but it stores **no rendered file** on the record (`files` is empty).
- `POST /api/printtemplate/{…}` exists (405 on GET where unknown controllers 404) but is
  undocumented and returned a generic 500 for every body shape tried, including with a real order id
  and its real bound template. Probing stopped there rather than blind-POSTing at a live CRM.

**Consequence, and why this is still high fidelity:** we reproduce the document from *Fireberry's own
template* plus *Fireberry's own data* — not a layout of our invention. The one transformation needed
is the repeating row: find the `<tr>` whose cells contain object-17 tokens and clone it per line item,
ordered by `itemorder`. Worth raising a Fireberry support ticket for an official render endpoint; if
one appears, it replaces this step without touching anything else.

## Data model

```sql
-- agreements gains provenance. All nullable, all additive.
source_kind      text  -- 'blank' | 'xtra_template' | 'crm_template' | 'crm_document'
crm_object_type  integer  -- flows 3 and 4: which CRM object
crm_record_id    text     -- flow 4: WHICH business record (order 1758)
merge_snapshot   jsonb    -- flows 3 and 4: the values used, frozen at creation
-- already present: company_id, template_id, crm_document_id (an imported CRM *file*)
```

`crm_record_id` is what answers, in six months, "this signature was on quote 1758 for customer X".
It is distinct from `crm_document_id`, which means "this document is a copy of a file that was
attached to a CRM record".

`merge_snapshot` is what makes a created document immune to later CRM edits: Fireberry is the source
of values **at creation time**, and the agreement is a frozen snapshot from that moment on.

## Write-back target

Write-back already planned in Phase 7 uploads to the company record. For flow 4 the target is the
**source record itself** (`crm_object_type` + `crm_record_id`) — quote 1758 receives the signed PDF,
not just the customer card. Idempotency is by the existing write-back state on the agreement, so a
retry never uploads a second copy.

## "New document" — the four options

```
מסמך חדש
├── יצירה מאפס            → the composer
├── מתבנית XTRA Sign      → templates saved here
├── מתבנית Fireberry      → object 27, merged against the chosen company
└── ממסמך קיים ב-Fireberry → the company's own orders/quotes, e.g. "הצעה 1758 · 11,000 ₪ · 07/03/2024"
```
Reached from a company's page, the company is already chosen and options 3 and 4 are scoped to it.
