# Hebrew copy catalog — XTRA Sign

Inventory of every Hebrew user-facing string in the product, for hand-off to a copy editor.
Regenerate with `npx tsx scripts/product/copy-catalog.ts`.

## Files

- `hebrew-copy-catalog.json` — the catalog, a plain JSON array of rows (2902 rows).
- `hebrew-copy-catalog.csv` — the same rows, UTF-8 with BOM (opens correctly in Excel), CRLF line ends, all fields quoted; `variables` joined with ` | `.
- this README — counts and method.

## Snapshot

- branch: feat/tourism-2026-onboarding
- commit: 5b657d12c9b55a79704cfd30f46a44402746ab57
- snapshot: 2026-09-07T12:03:15.705Z
- rows marked "new 2026-09-07 UX pass": **68** (text not present in the last commit's version of the file — the uncommitted UX-pass edits — or carried forward from the previous catalog); rows committed earlier but absent from the previous catalog are noted "not in previous catalog".

Locations (`file` + `line`) refer to the working tree at the snapshot, uncommitted UX-pass edits included.

## Counts

- Rows: **2902** (one row per distinct Hebrew text; repeats are listed in `notes` as "same text also at").
- Source files scanned: 442 `.ts/.tsx` files under `src/app`, `src/components`, `src/lib`, `src/server` (tests excluded); 349 of them contain Hebrew.
- Excluded on purpose: the agreement's own contract text (`src/app/[slug]/AgreementText.tsx`, the `AgreementText` body) — legal text of the agreement, not product copy; the XTRA AI system prompt and tool descriptions (`src/server/ai/`) — instructions to the model.
- Distinct screens named in `screen`: 140.

### Rows per kind

| kind | rows |
|---|---|
| other | 991 |
| error | 390 |
| help | 378 |
| button | 268 |
| label | 187 |
| public_page | 136 |
| aria | 126 |
| heading | 100 |
| setting | 75 |
| email_body | 55 |
| report | 54 |
| success | 39 |
| placeholder | 31 |
| empty_state | 22 |
| dialog | 20 |
| sms | 13 |
| status | 9 |
| legal | 6 |
| nav | 1 |
| step | 1 |

## Row shape

| field | meaning |
|---|---|
| `text` | the Hebrew exactly as it is in code. Interpolations are kept as written: `{{signer_name}}` (message templates), `${name}` (template literals), `{expr}` (JSX). `<b>…</b>`, `<Link>…</Link>` mark inline markup inside one sentence. |
| `file`, `line` | the representative occurrence (the first in file order). |
| `screen` | where a person sees it — screen, mail, SMS, PDF page. Names come from the previous catalog where the file was already known, otherwise from the file's folder. |
| `kind` | a heuristic from the syntactic context (tag chain, attribute, enclosing call, property name, text patterns): nav, heading, tab, button, label, placeholder, help, error, success, empty_state, dialog, status, step, setting, report, email_subject, email_body, sms, public_page, aria, legal, other. Strong hint, not a hand review. |
| `variables` | placeholders that must not change. |
| `notes` | "new 2026-09-07 UX pass", glossary terms present, other occurrences of the same text. |

## The rule for editing

**Variables and functional meaning must not change; only the Hebrew text is editable.**

- Placeholders in `variables` must appear in the edited text exactly as written (order may change; none may be dropped).
- Rows typed `legal`, `sms` and `public_page` must not change meaning without approval.
- Glossary terms (קמפיין, הפצה, נמענים, הרשמות, הסכמים, דורש טיפול, ספקים, לקוחות, CRM, XTRA Sign) are flagged in `notes` — keep them consistent across all rows.
- Rows that share a `file` + `line` are gender / number / state variants of one sentence — edit them together.

## Method

1. **Extraction** (`scripts/product/copy-catalog.ts`): every `.ts/.tsx` file under the four source roots is parsed with the TypeScript compiler API. Collected: string literals, template literals (placeholders kept as `${…}`), JSX text, and JSX attributes containing Hebrew letters (U+0590–U+05FF). A paragraph mixing JSX text with inline expressions or inline tags (`<b>`, `<span>`, `<Link>` …) is captured as one sentence with `{…}` placeholders, so the editor sees whole sentences; the literals inside those expressions are still listed as their own rows. Comments never enter.
2. **Exclusions**: `__tests__`, `*.test.ts`, `src/test`, `src/labs`; `console.*` / logger calls; import / export specifiers, type literals, object keys and element-access keys; the agreement contract and the AI prompt named above.
3. **Dedupe**: by exact text; the first occurrence in file order is the representative, the rest go to `notes`.
4. **Change marker**: each file is also extracted from `git show HEAD:<file>`; a text absent there is uncommitted work and is noted "new 2026-09-07 UX pass". Rows that already carried the note in the previous catalog keep it, so the marker survives a regeneration after the commit. A text that is committed but was not in the previous catalog is noted "not in previous catalog".
5. **Checks**: the CSV parses back to the same number of rows with 7 columns and identical texts.

## Not covered / caveats

- The XTRA AI assistant's free-form replies are generated and cannot be catalogued.
- The signed PDF's agreement body is the user's own uploaded document; only system-generated text is listed.
- Public assets (`public/**` title images) carry Hebrew as pixels; their `alt` texts are in the catalog (`kind: aria`).
- Sentences assembled at runtime from several pieces appear as several rows.
