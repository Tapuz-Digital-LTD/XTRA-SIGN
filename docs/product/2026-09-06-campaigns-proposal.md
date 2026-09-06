# Campaigns — proposal for approval (IA, data model, Inforu, open questions)

**Status:** for approval before implementation · **Date:** 2026-09-06
**Companion:** [Inforu capability matrix](../integrations/inforu-campaigns.md) — what the official documentation actually supports.

Terminology used throughout (and to be used in the UI): **קמפיין** = the business
envelope (e.g. חודש התיירות הישראלית 2026), independent of Inforu; **הפצה** =
one SMS and/or email send from a campaign through Inforu (0..N per campaign);
**נמענים** = who we want to reach; **הרשמות** = who joined through a public
form/page; **הסכמים** = the XTRA Sign signing process.

## 1. Campaign IA

### Two kinds, one screen

`/campaigns` replaces "פרויקטים" in the navigation and page titles. The
`groups` table stays as it is (additive columns only); the UI word changes.

```
קמפיינים                                             [+ קמפיין חדש]
הכול | קמפיינים ציבוריים | קמפייני חתימות | ארכיון      🔍 חיפוש

שם                        סוג      סטטוס   נמענים  הרשמות  נחתמו  פעילות אחרונה   ⋯
חודש התיירות הישראלית 2026  ציבורי   פעיל    1,204   528     481    לפני 3 שעות     ⋯
ספקי לוגיסטיקה Q4          חתימות   פעיל    36      —       29     אתמול           ⋯
```

Row menu (existing `RowMenu`): פתיחה · הגדרות · העבר לארכיון · מחיקה (policy).

### Wizard "קמפיין חדש" (3 short steps)

1. **מה רוצים לעשות?** — two large cards:
   - **קמפיין ציבורי** — "לפרסם פעילות, לאסוף הרשמות ולחבר דף/טופס ציבורי."
   - **קמפיין חתימות** — "לשלוח הסכמים לספקים או לקוחות שכבר יש לי."
2. **פרטים** — שם הקמפיין, תאריך התחלה (רשות), תאריך סיום (רשות), בעלים.
3. Kind-specific:
   - Public → **איך אנשים יצטרפו?** four cards: טופס ציבורי של XTRA Sign (URL
     מוכן) · הטמעת הטופס באתר שלי (embed code) · חיבור דרך API · דף קמפיין
     מותאם אישית (הסבר: "אינו נבנה בתוך XTRA Sign; לצורך עיצוב ופיתוח דף ייעודי
     יש לפנות למפתח"; when a skin is already bound: "עמוד הקמפיין מחובר ✓ ·
     פתח עמוד · העתק קישור · שינוי כתובת"). Then one setting **לאחר הרשמה**:
     "שמור הרשמה" / "הרשמה וחתימה אוטומטית" (the tourism flow).
   - Signatures → **קהל** (ספקים / לקוחות / Excel-CSV / בחירה ידנית) → **הסכם**
     (template) → **בדיקה** (who is fine / who lacks details) → Create.

Create works immediately: no message needs editing first (system defaults).

### Campaign navigation (tabs)

- Public: **סקירה | הפצות | הרשמות | הסכמים | דוחות | הגדרות**
- Signatures: **סקירה | נמענים | הסכמים | דוחות | הגדרות**

Tabs that do not apply to the kind are not shown.

**סקירה (public):** status pill, page URL (open / copy), נמענים בהפצות, כניסות,
הרשמות, חתמו, a short activity list, two buttons: **הפצה חדשה**, **פתח עמוד**.

**הפצות:** table (שם, ערוצים, קהל, נשלחו, נמסרו, נפתחו (email), לחצו, הרשמות,
חתימות, זמן, סטטוס, ⋯). **+ הפצה חדשה** opens the wizard:
קהל → ערוצים → תוכן → תזמון → בדיקה ושליחה.

- קהל: ספקים קיימים · לקוחות קיימים · הרשמות של הקמפיין (with segments when
  a parent distribution exists: לא פתחו / פתחו ולא לחצו / לחצו ולא נרשמו /
  נרשמו ולא חתמו — email; נמסר ולא לחץ / לחץ ולא נרשם / נרשם ולא חתם — SMS) ·
  בחירה ידנית · Excel/CSV (upload → preview → column mapping → validation →
  duplicates → confirm; minimum שם, טלפון, אימייל; optional חברה, ח.פ., custom
  variables). Never sends straight after upload.
- Recipient preview: "1,204 נמענים · 1,170 עם טלפון תקין · 986 עם אימייל
  תקין · 34 ללא ערוץ תקין" and, with both channels, the sentence that a
  person with both gets both. Suppression check (`CheckIfUnsubscribe`) runs
  here and shows "N הוסרו לפי רשימת ההסרה".
- ערוצים: ☑ SMS ☑ Email (either or both). WhatsApp out of scope.
- תוכן: **content type** — קישור לעמוד הקמפיין (UTM auto: utm_source=inforu,
  utm_medium=sms|email, utm_campaign=<campaign>, utm_content=<distribution>) ·
  קישור אחר · קובץ (email attachment; our own cap 10 MB, 3 files) · **הסכם
  אישי לחתימה** (one agreement per recipient from a template — audience must
  be suppliers/customers; the message carries `{{signing_link}}`).
  SMS editor: sender id (from the account's allowed list), text, variables
  chip picker, live character count and segment estimate (GSM-7 vs UCS-2 per
  Inforu's documented counting), preview. Email composer: From name, Subject,
  Preheader, body (light rich text), image, CTA, campaign link, variables;
  desktop/mobile preview; "שלח הודעת בדיקה".
- תזמון: עכשיו / תאריך ושעה (Asia/Jerusalem).
- בדיקה ושליחה: audience count per channel, time, message previews, one
  confirmation; idempotent (a browser retry cannot send twice).

**דוחות (public):** ביצועי הקמפיין (the funnel we built, extended with the
Inforu stages: נשלחו → נמסרו → נפתחו (email) → לחצו → הגיעו לדף → נרשמו →
חתמו) · ביצועי הפצות (per distribution + channel comparison, no "open rate"
for SMS) · Traffic · Registrations · Signatures.

**Distribution report:** summary (נשלחו, נמסרו, נפתחו — email only, לחצו,
הרשמות, חתימות) + table (שם | טלפון/מייל | מסירה | פתיחה | קליק | הרשמה |
חתימה), only the columns the channel has; "שליחת המשך" creates a child
distribution with the chosen segment, never edits the parent.

**הגדרות:** the existing sections (פרטים, טופס ציבורי, הרשמה וחתימה עצמאית,
התראות) plus **הודעות** (below) and the campaign dates/owner.

### הודעות (message templates) — 3 layers

System default → campaign override → distribution copy. Cards/accordion, all
collapsed, each showing "משתמש בברירת המחדל" or "מותאם לקמפיין" with
"שחזר לברירת מחדל": הזמנה לחתימה (SMS | Email) · תזכורת (SMS | Email) ·
לאחר חתימה (Email) · הרשמה הושלמה (SMS | Email; public only). Editor:
variable chip picker (נמען / חברה / קמפיין / מסמך / ארגון / הפצה + שדות
הטופס when the form has custom fields), preview with sample data (or a real
recipient, no send), "שלח הודעת בדיקה", SMS character/segment count. Missing
variables are validated before a send ("ל-12 נמענים חסר ערך עבור 'שם החותם'"
→ fix / exclude / fallback); link variables never fall back. OTP text stays
system-controlled (WebOTP format), with at most a small brand prefix.

The engine already exists in code (`src/lib/message-template.ts`:
allow-listed `{{keys}}`, `{{key | "fallback"}}`, context escaping, missing/
unknown reporting, system defaults) and now renders the invitation, reminder,
signed-confirmation and registration emails; the Messages UI and the campaign
override storage are the remaining work.

### Login / OTP polish

One reusable `OtpInput` (single underlying input, `autocomplete="one-time-code"`,
`inputmode="numeric"`, paste, WebOTP with AbortController and timeout, resend
countdown, change number) used by login, signing and the campaign page.
Login: logo, clean card, phone, one CTA, good errors, loading. The Inforu OTP
SMS gets the WebOTP domain-bound last line (`@<host> #<code>`) — checked
against the standard format; iOS autofill keeps working.

## 2. Data model (additive only)

| Table / column | Purpose |
|---|---|
| `groups.kind_of_campaign text default 'signature'` | `public` / `signature`. Backfill: groups with `landing_enabled` or `selfService.enabled` → `public`; everything else `signature`. No destructive rename; UI says "קמפיין". |
| `groups.starts_at`, `groups.ends_at timestamptz` | Optional campaign dates. |
| `groups.message_overrides jsonb` | Campaign-level message templates (`{ invitation: {sms, email}, reminder: …, signed_confirmation: …, registration_completed: … }`). Missing keys = system default. |
| `distributions` | `id, organization_id, group_id, parent_id (follow-up), name, status (draft/scheduled/sending/sent/failed/canceled), channels jsonb, content_type (campaign_link/url/file/agreement), content jsonb (subject, preheader, body, cta, url, template_id, attachments…), audience jsonb (source + filters + segment), scheduled_at, sent_at, created_by, created_at, recipient_count, idempotency_key unique` |
| `distribution_recipients` | `id, distribution_id, company_id?, lead_id?, name, phone?, email?, variables jsonb, sms_status, email_status, inforu_sms_message_id, inforu_email_campaign_id, agreement_id? (for personal agreements), suppressed_reason?, resolved_content jsonb (snapshot per channel), created_at` — indexes on distribution_id, phone, email, agreement_id |
| `distribution_events` | `id, distribution_id, recipient_id?, channel, event (sent/delivered/failed/clicked/opened/bounced/unsubscribed), occurred_at, source (push/pull), external_id, dedupe_key unique, raw_code text (server-side only), created_at` — the idempotent ingestion target |
| `suppressions` | `organization_id, channel, value (phone/email normalised), reason, source (inforu_sync/api/manual), created_at` unique (organization_id, channel, value) — local cache of Inforu's unsubscribe list, refreshed nightly and before each send |
| `campaign_events` | exists; gains nothing — UTM ties clicks to distributions (`utm_content=<distribution id>`) |
| `message_sends` | `id, organization_id, group_id?, distribution_id?, agreement_id?, channel, event (invitation/reminder/…), recipient, subject, body_snapshot, variables jsonb, sent_at, provider_message_id, is_test boolean` — the "snapshot when actually sent" the templates need |

Indexes on every foreign key and on `(group_id, created_at)`. All migrations are `ADD COLUMN` / `CREATE TABLE`.

## 3. Inforu — what is real

See the capability matrix. Summary of what shapes the design:

- SMS: send, schedule, cancel, DLR pull (push needs support), click tracking
  via short links, unsubscribe link, **no open tracking**.
- Email: send new campaign with `CampaignRefId` = our distribution id,
  schedule/stop, job status, **DSN/open/click/return/unsubscribe pull**
  (support must enable storage), attachments (URL or base64), reply-to and
  from name (white-listed).
- Suppression: `CheckIfUnsubscribe` (≤100 per call) before every send; nightly
  sync of the unsubscribe list into `suppressions`; never `IgnoreUnsubscribeCheck`.
- Rate limit 30 req/s: batch recipients per request (the API takes arrays) and
  throttle the sync jobs.
- No test-send API: a test is a normal send flagged `is_test`, excluded from
  statistics.
- One client (`inforu.ts`) — the distribution adapter is added to it.

## 4. Implementation order (after approval)

1. Campaign kind + list + wizard (both kinds), navigation rename, existing
   projects classified additively.
2. Message templates UI (3 layers) on the existing engine; snapshots
   (`message_sends`).
3. Distributions: model, wizard, recipient import/validation, suppression
   check, adapter (SMS/email), scheduling, idempotent send, test send.
4. Event ingestion (pull jobs + push endpoint for SMS DLR), distribution
   report, campaign report extension, follow-up distributions.
5. Login/OTP polish with the shared `OtpInput` and WebOTP.
6. Mobile QA at 375/390/430 for list, wizard, composer, reports.

## 5. Open questions (business decisions only)

1. **Sender identities.** Which SMS sender id(s) and which email From/Reply-to
   addresses are white-listed in the Inforu account? These must exist in
   Inforu before any distribution; I will expose them as a fixed list in the
   composer rather than a free text box.
2. **Inforu support switches.** Push DLR (JSON) and email-notification storage
   need Inforu support to enable. Shall I write to Inforu support on your
   behalf with the exact requests from the matrix, or do you prefer to?
3. **Personal-agreement distributions and consent.** When a distribution's
   content is "הסכם אישי לחתימה", the SMS/email is effectively an invitation
   to sign: should it count against the campaign's signing-link TTL (30 days)
   or have its own?
4. **Campaign dates.** Should a campaign past its end date block new
   registrations automatically (page shows "ההרשמה הסתיימה") or only warn in
   the UI?
5. **Excel audience privacy.** Imported CSV rows that never become suppliers:
   keep them only inside the distribution (deleted with it) or promote to
   suppliers on request? Proposal: keep inside the distribution.
6. **Follow-up cadence guardrail.** A minimum interval between a distribution
   and its follow-up to the same person (proposal: 24 hours) — yes/no.

Nothing else needs a decision; everything else follows the messages above.
