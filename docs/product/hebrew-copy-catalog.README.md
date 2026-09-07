# Hebrew copy catalog — XTRA Sign

Inventory of every Hebrew user-facing string in the product, for hand-off to a copy editor.

## Files

- `hebrew-copy-catalog.json` — the catalog, a plain JSON array of rows (2412 rows).
- `hebrew-copy-catalog.csv` — the same rows, UTF-8 with BOM (opens correctly in Excel), CRLF line ends, all fields quoted; `variables` joined with ` | `.
- this README — counts and method.

## Snapshot

- branch: feat/tourism-2026-onboarding
- commit: 790cfffd52f95be30128f8668bda061599129bc2
- snapshot: 2026-09-07T07:40:15Z
- uncommitted src changes:

Locations (`file:line`) refer to that commit. `src/**` was identical on `main` and `feat/tourism-2026-onboarding` when the run started; the branch then moved on (two more commits) and the catalog was regenerated from the final snapshot above.

## Counts

- Rows: **2412** (one row per distinct Hebrew text; repeats are listed in `notes` as "same text also at").
- Source files scanned: 381 `.ts/.tsx` files under `src/app`, `src/components`, `src/lib`, `src/server` (tests excluded); 296 of them contain user-facing Hebrew.
- Excluded on purpose: 18 strings of the agreement's own contract text (`src/app/[slug]/AgreementText.tsx` lines 15–60) — legal text of the agreement, not product copy.
- Distinct screens / mails / SMS / PDF pages named in `screen`: 119.

### Rows per type

| type | rows |
|---|---|
| other | 545 |
| error | 426 |
| button | 306 |
| label | 303 |
| aria | 104 |
| heading | 90 |
| status | 86 |
| email_body | 78 |
| dialog | 70 |
| success | 65 |
| report | 55 |
| help | 49 |
| empty_state | 49 |
| public_page | 36 |
| placeholder | 34 |
| setting | 31 |
| tab | 18 |
| legal | 17 |
| step | 17 |
| email_subject | 15 |
| nav | 11 |
| sms | 7 |

## Row shape

| field | meaning |
|---|---|
| `key` | stable catalog identifier `area.screen.element` (e.g. `messages.defaults.default_messages.invitation.email.subject`, `campaigns.wizard.button_3`). Unique. For constant tables the element part mirrors the object path in code; otherwise it is `<type>_<n>` in file order. |
| `text` | the Hebrew exactly as it is in code. Interpolations are kept as written: `{{signer_name}}` (message templates), `${name}` (template literals), `{expr}` (JSX). `<b>…</b>`, `<Link>…</Link>` mark inline markup inside one sentence. |
| `location` | `file:line` of the representative occurrence. |
| `screen` | where a person sees it — screen path, mail, SMS, PDF page. |
| `context` | one sentence: what kind of element and when it shows (loading-state button label, one branch of a gendered variant, server error shown as a toast, …). |
| `type` | one of: nav, heading, tab, button, label, placeholder, help, error, success, empty_state, dialog, status, step, setting, report, email_subject, email_body, sms, public_page, aria, legal, other. |
| `variables` | placeholders that must not change. |
| `notes` | glossary terms, legal / OTP flags, SMS length, sample-data flags, other occurrences. |

## The rule for editing

**Keys, variables and functional meaning must not change; only the Hebrew text is editable.**

- Do not rename or remove `key`s — they are how edits are mapped back to code.
- Placeholders in `variables` must appear in the edited text exactly as written (order may change; none may be dropped; link variables must stay).
- Rows typed `legal` (consent text, OTP SMS, the PDF signature-certificate page) and rows noted "OTP flow" must not change meaning without approval.
- Glossary terms (קמפיין, הפצה, נמענים, הרשמות, הסכמים, דורש טיפול, ספקים, לקוחות, CRM, XTRA Sign) are flagged in `notes` — keep them consistent across all rows.
- SMS rows: Hebrew is sent as UCS-2 — 70 characters fit one segment, 67 per segment when split; the note gives the current fixed-text length before placeholders are filled.
- Rows flagged "אחת מגרסאות טקסט מותנות" are gender / number / state variants of one sentence — edit the siblings together (they share a `location` line).
- Rows flagged "sample / preview value" are deliberately fake data for preview screens; they may be edited but never made to look real.

## Method

1. **Extraction** (script kept outside the repo): every `.ts/.tsx` file under the four source roots was parsed with the TypeScript compiler API. Collected: string literals, template literals (placeholders kept as `${…}`), JSX text, and JSX attributes containing Hebrew letters (U+0590–U+05FF). A paragraph mixing text with inline expressions or inline tags (`<b>`, `<span>`, `<Link>` …) is captured as one sentence with `{…}` placeholders, so the editor sees whole sentences. Comments never enter (they are not AST string nodes).
2. **Exclusions**: `__tests__`, `*.test.ts`, `src/test`, `src/labs`, `scripts/**`, `docs/**`, `drizzle/**`; `console.*` / logger calls; LLM-facing text (the XTRA AI system prompt and tool-schema `description`s); import / export specifiers, type literals, object keys and element-access keys; the agreement contract clauses named above.
3. **Dedupe**: by exact text. The representative location prefers a constant-table definition over a comparison or a conditional branch; the rest are listed in `notes`.
4. **Enrichment**: `screen` comes from a file → screen map (every scanned file is mapped; an unmapped file fails the build). `type` and `context` come from the syntactic context of each node — JSX tag chain (button / h2 / th / option / Dialog …), attribute name (aria-label, placeholder, hint …), property name and path (`DEFAULT_MESSAGES.invitation.email.subject`, `{ ok: false, message }`, `error.message`), enclosing call (`setError`, `renderEmail`, `notify`, `alertAdmins`, `otpSmsText` …), and text patterns as a last resort. `type` is therefore a strong heuristic, not a hand review: `other` is the residual bucket (paragraph prose, counters, activity-feed lines).
5. **Checks**: every key unique; the CSV parses back to the same 2412 rows with 8 columns and identical texts; a random sample of 60 Hebrew source lines (comments excluded) all had their phrases present in the catalog.

## Not covered / caveats

- The XTRA AI system prompt (`src/server/ai/agent.ts`, `SYSTEM`) and tool descriptions are instructions to the model, not copy shown to users, and are excluded; the assistant's free-form replies are generated and cannot be catalogued.
- The signed PDF's agreement body is the user's own uploaded document; only the system-generated certificate page (`pdf.certificate.*`) is listed.
- Public assets (`public/tourism-2026/*.webp` title images) carry Hebrew as pixels; their `alt` texts are in the catalog (`type: aria`).
- Sentences assembled at runtime from several pieces appear as several rows (the merged JSX form covers the common case; template-literal fragments such as ` · נכשלו ${n}` stay separate).
- Keys are catalog identifiers, not identifiers in the code; a later code change can shift `location` lines and, for non-constant rows, the `_<n>` counters.
