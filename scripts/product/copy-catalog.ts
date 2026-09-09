/**
 * The Hebrew copy catalog: every user-facing Hebrew string in the product,
 * for a language review.
 *
 *   npx tsx scripts/product/copy-catalog.ts
 *
 * Writes docs/product/hebrew-copy-catalog.{json,csv} and refreshes the counts
 * in hebrew-copy-catalog.README.md. Rows whose text was not in the previous
 * catalog are noted "new 2026-09-07 UX pass"; the note is carried forward on
 * later runs, so the marker survives a regeneration.
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const ROOTS = ['src/app', 'src/components', 'src/lib', 'src/server']
const OUT = 'docs/product/hebrew-copy-catalog'
const PASS_NOTE = 'new 2026-09-07 UX pass'
const HEBREW = /[֐-׿]/
const GLOSSARY = ['קמפיין', 'הפצה', 'נמענים', 'הרשמות', 'הסכמים', 'דורש טיפול', 'ספקים', 'לקוחות', 'CRM', 'XTRA Sign']
const INLINE_TAGS = new Set(['b', 'strong', 'em', 'i', 'span', 'code', 'a', 'Link', 'kbd', 'u', 'small'])

type Row = { text: string; file: string; line: number; screen: string; kind: string; variables: string[]; notes: string }

// ── files ──────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : walk(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r)))
  .map((f) => relative(ROOT, f))
  .filter((f) => !f.startsWith('src/test/') && !f.startsWith('src/labs/'))
  .sort()

// ── screens ────────────────────────────────────────────────────────────────

/** Previous catalog: the file → screen names it used, and its texts, so wording stays stable across runs. */
type Previous = { text: string; file?: string; location?: string; screen: string; notes?: string }
let previous: Previous[] = []
try {
  previous = JSON.parse(readFileSync(`${OUT}.json`, 'utf8')) as Previous[]
} catch {
  previous = []
}
const previousScreen = new Map<string, string>()
const previousNotes = new Map<string, string>()
for (const row of previous) {
  const file = row.file ?? row.location?.replace(/:\d+$/, '')
  if (file && !previousScreen.has(file)) previousScreen.set(file, row.screen)
  if (row.notes?.includes(PASS_NOTE)) previousNotes.set(row.text, PASS_NOTE)
}
const previousTexts = new Set(previous.map((r) => r.text))

const DIR_SCREENS: [RegExp, string][] = [
  [/^src\/app\/\[slug\]\//, 'עמוד ציבורי: קמפיין'],
  [/^src\/app\/sign\//, 'עמוד ציבורי: חתימה'],
  [/^src\/app\/join\//, 'עמוד ציבורי: הצטרפות'],
  [/^src\/app\/page\.tsx$/, 'בית (דשבורד)'],
  [/^src\/app\/login\//, 'כניסה למערכת'],
  [/^src\/app\/agreements\//, 'הסכמים (רשימה)'],
  [/^src\/app\/documents\//, 'הסכם (דף המסמך)'],
  [/^src\/app\/suppliers\//, 'ספקים (רשימה)'],
  [/^src\/app\/customers\//, 'לקוחות (רשימה)'],
  [/^src\/app\/companies\//, 'כרטיס ספק/לקוח'],
  [/^src\/app\/projects\//, 'קמפיינים'],
  [/^src\/app\/groups\//, 'קבוצה'],
  [/^src\/app\/templates\//, 'תבניות'],
  [/^src\/app\/tracking\//, 'מעקב'],
  [/^src\/app\/settings\/(\w+)/, 'הגדרות'],
  [/^src\/app\/api\//, 'API — הודעות שרת'],
  [/^src\/components\/companies\//, 'ספקים/לקוחות'],
  [/^src\/components\/projects\//, 'קמפיין'],
  [/^src\/components\/reports\//, 'קמפיין → דוחות'],
  [/^src\/components\/documents\//, 'הסכמים (רשימה)'],
  [/^src\/components\/templates\//, 'תבניות'],
  [/^src\/components\/quick-send\//, 'שליחה מהירה (בית)'],
  [/^src\/components\/tags\//, 'תגים'],
  [/^src\/components\/follow-up\//, 'משימות המשך'],
  [/^src\/components\/settings\//, 'הגדרות'],
  [/^src\/components\/groups\//, 'קבוצה'],
  [/^src\/components\/invitations\//, 'קמפיין → הזמנות ומעקב'],
  [/^src\/components\/signer\//, 'עמוד ציבורי: חתימה'],
  [/^src\/components\/mail\//, 'מייל'],
  [/^src\/components\/ai\//, 'XTRA AI (עוזר צ׳אט)'],
  [/^src\/components\//, 'רכיב משותף'],
  [/^src\/server\/mail\//, 'מייל'],
  [/^src\/server\/sms\//, 'SMS'],
  [/^src\/server\/ai\//, 'XTRA AI (עוזר צ׳אט)'],
  [/^src\/server\/(\w[\w-]*)\//, 'הודעות שרת'],
  [/^src\/lib\//, 'טקסטים משותפים'],
]

function screenOf(file: string): string {
  const known = previousScreen.get(file)
  if (known) return known
  const hit = DIR_SCREENS.find(([re]) => re.test(file))
  if (!hit) return file
  const m = file.match(hit[0])
  return hit[1] === 'הגדרות' && m?.[1] ? `הגדרות → ${m[1]}` : hit[1] === 'הודעות שרת' && m?.[1] ? `${m[1]} — הודעות שרת` : hit[1]
}

// ── extraction ─────────────────────────────────────────────────────────────

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

function tagName(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText()
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText()
  return null
}

/** The nearest enclosing JSX tags, innermost first, plus the attribute the node sits in. */
function context(node: ts.Node): { tags: string[]; attr: string | null; call: string | null; prop: string | null; role: string | null } {
  const tags: string[] = []
  let attr: string | null = null
  let call: string | null = null
  let prop: string | null = null
  let role: string | null = null
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p) && attr === null) attr = p.name.getText()
    const tag = tagName(p)
    if (tag) {
      tags.push(tag)
      if (role === null && ts.isJsxElement(p)) {
        const r = p.openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === 'role') as ts.JsxAttribute | undefined
        const init = r?.initializer
        if (init && ts.isStringLiteral(init)) role = init.text
      }
    }
    if (ts.isCallExpression(p) && call === null) call = p.expression.getText()
    if (ts.isPropertyAssignment(p) && prop === null) prop = p.name.getText()
    if (ts.isVariableDeclaration(p) && prop === null) prop = p.name.getText()
    if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      if (tags.length > 0) break
    }
  }
  return { tags, attr, call, prop, role }
}

function kindOf(file: string, text: string, node: ts.Node): string {
  const c = context(node)
  const tag = c.tags[0] ?? ''
  const tagsAll = c.tags.join(' ')
  if (/^src\/app\/(\[slug\]|sign|join)\//.test(file) || /^src\/components\/signer\//.test(file)) {
    if (/הסכם|מצהיר|תנאי|מאשר/.test(text) && /^(p|li|h2)$/.test(tag)) return 'legal'
    return 'public_page'
  }
  if (/^src\/(server|components)\/mail\//.test(file)) return c.prop === 'subject' || /subject/i.test(c.prop ?? '') ? 'email_subject' : 'email_body'
  if (/sms/i.test(file) || /sms/i.test(c.call ?? '') || /sms/i.test(c.prop ?? '')) return 'sms'
  if (c.attr && /^(aria-|alt$|title$)/.test(c.attr)) return 'aria'
  if (c.attr === 'placeholder') return 'placeholder'
  if (c.role === 'alert' || /setError|throw new Error|fail\(|failure\(|errorOf/.test(c.call ?? '') || /^(error|message|reason)$/.test(c.prop ?? '') || /נכשל|לא ניתן|לא הצלחנו|שגיאה|חסר|אין הרשאה|לא נמצא/.test(text)) return /^src\/server\//.test(file) || c.role === 'alert' || /נכשל|שגיאה|לא ניתן|לא הצלחנו/.test(text) ? 'error' : 'help'
  if (c.role === 'status' || (/setNotice|setFlash|setMessage|setSyncMsg|setResult|setSaved/.test(c.call ?? '') && !/נכשל|שגיאה/.test(text))) return 'success'
  if (/intro|blurb|description|hint/i.test(c.prop ?? '')) return 'help'
  if (/^(button|Link|a|summary)$/.test(tag) || c.tags.includes('button')) return 'button'
  if (/^h[1-6]$|^legend$/.test(tag)) return 'heading'
  if (tag === 'option' || tag === 'select') return 'label'
  if (/^(label|th|dt|td)$/.test(tag) || c.tags.includes('label')) return 'label'
  if (/nav/.test(tagsAll) || /^(nav|tabs|TABS)$/i.test(c.prop ?? '')) return /tab/i.test(c.prop ?? '') ? 'tab' : 'nav'
  if (/עדיין אין|אין .* עדיין|יופיע כאן|לא נמצא/.test(text)) return 'empty_state'
  if (c.tags.some((t) => /Dialog|Drawer|dialog/.test(t))) return 'dialog'
  if (/STEPS|STEP_LABELS|STEP_INTROS|steps/.test(c.prop ?? '')) return 'step'
  if (/^src\/app\/settings\//.test(file) || /Settings/.test(file)) return 'setting'
  if (/^src\/components\/reports\//.test(file)) return 'report'
  if (/LABELS|STATUS|TONE|TEXT$/.test(c.prop ?? '') && text.length < 30) return 'status'
  if (/^(p|li|dd|small)$/.test(tag) && c.tags.length > 0) return 'help'
  return 'other'
}

function variablesOf(text: string): string[] {
  return [...text.matchAll(/\{\{\s*[\w.]+\s*\}\}|\$\{[^}]+\}|\{[^{}]+\}/g)].map((m) => m[0])
}

/** `{' '}` is a space; a short expression is shown as written; anything longer is `{…}` so the text stays stable. */
function placeholder(ch: ts.JsxExpression): string {
  const text = collapse(ch.expression?.getText() ?? '')
  if (/^'\s*'$/.test(text)) return ' '
  return text.length <= 40 ? `{${text}}` : '{…}'
}

/** JSX text mixed with expressions or inline tags is one sentence; the expressions become {…}. */
function mergedParagraph(el: ts.JsxElement | ts.JsxFragment): string | null {
  const children = el.children.filter((ch) => !(ts.isJsxText(ch) && ch.text.trim() === ''))
  const hasText = children.some((ch) => ts.isJsxText(ch) && HEBREW.test(ch.text))
  const hasOther = children.some((ch) => !ts.isJsxText(ch))
  if (!hasText || !hasOther) return null
  if (children.some((ch) => (ts.isJsxElement(ch) || ts.isJsxSelfClosingElement(ch)) && !INLINE_TAGS.has(tagName(ch) ?? ''))) return null
  const parts = children.map((ch) => {
    if (ts.isJsxText(ch)) return ch.text
    if (ts.isJsxExpression(ch)) return placeholder(ch)
    if (ts.isJsxElement(ch)) return `<${tagName(ch)}>${collapse(ch.children.map((x) => (ts.isJsxText(x) ? x.text : ts.isJsxExpression(x) ? placeholder(x) : '')).join(''))}</${tagName(ch)}>`
    return ''
  })
  return collapse(parts.join(''))
}

function extract(file: string, code = readFileSync(file, 'utf8')): Row[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rows: Row[] = []
  const merged = new Set<ts.Node>()
  const screen = screenOf(file)
  const isAgreementText = file === 'src/app/[slug]/AgreementText.tsx'
  const isAgent = file === 'src/server/ai/agent.ts'

  const add = (text: string, node: ts.Node, kind?: string) => {
    const clean = collapse(text)
    if (!HEBREW.test(clean)) return
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    rows.push({ text: clean, file, line, screen, kind: kind ?? kindOf(file, clean, node), variables: variablesOf(clean), notes: '' })
  }

  const skip = (node: ts.Node): boolean => {
    const p = node.parent
    if (!p) return false
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true
    if ((ts.isPropertyAssignment(p) && p.name === node) || ts.isElementAccessExpression(p) && p.argumentExpression === node) return true
    for (let a: ts.Node | undefined = p; a; a = a.parent) {
      if (ts.isCallExpression(a) && /^(console\.\w+|logger?\.\w+|log)$/.test(a.expression.getText())) return true
      if (isAgreementText && ts.isFunctionDeclaration(a) && a.name?.getText() === 'AgreementTerms' && !ts.isStringLiteral(node)) return true
      if (isAgent && ts.isVariableDeclaration(a) && a.name.getText() === 'SYSTEM') return true
      if (file.startsWith('src/server/ai/') && ts.isPropertyAssignment(a) && a.name.getText() === 'description') return true
    }
    return false
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const para = skip(node) ? null : mergedParagraph(node)
      if (para) {
        add(para, node)
        for (const ch of node.children) if (ts.isJsxText(ch)) merged.add(ch)
      }
    }
    if (ts.isJsxText(node) && !merged.has(node) && !skip(node)) add(node.text, node)
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !skip(node)) add(node.text, node)
    else if (ts.isTemplateExpression(node) && !skip(node)) add(node.head.text + node.templateSpans.map((s) => `\${${collapse(s.expression.getText())}}${s.literal.text}`).join(''), node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return rows
}

// ── dedupe, notes, output ──────────────────────────────────────────────────

const all = files.flatMap((f) => extract(f))
const byText = new Map<string, Row[]>()
for (const row of all) byText.set(row.text, [...(byText.get(row.text) ?? []), row])

/** The same texts as of the last commit: a text missing there is uncommitted work — this pass. */
const committed = new Set(
  files.flatMap((f) => {
    try {
      return extract(f, execSync(`git show HEAD:${JSON.stringify(f)}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).map((r) => r.text)
    } catch {
      return []
    }
  }),
)

const rows: Row[] = [...byText.values()].map((group) => {
  const [first, ...rest] = group
  const notes: string[] = []
  if (!committed.has(first.text) || previousNotes.has(first.text)) notes.push(PASS_NOTE)
  else if (!previousTexts.has(first.text)) notes.push('not in previous catalog')
  const terms = GLOSSARY.filter((t) => first.text.includes(t))
  if (terms.length) notes.push(`glossary: ${terms.join(', ')}`)
  if (rest.length) notes.push(`same text also at: ${rest.slice(0, 3).map((r) => `${r.file}:${r.line}`).join(', ')}${rest.length > 3 ? ` (+${rest.length - 3} more)` : ''}`)
  return { ...first, notes: notes.join('; ') }
})

writeFileSync(`${OUT}.json`, `${JSON.stringify(rows, null, 2)}\n`)

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
const csv = [
  ['text', 'file', 'line', 'screen', 'kind', 'variables', 'notes'],
  ...rows.map((r) => [r.text, r.file, String(r.line), r.screen, r.kind, r.variables.join(' | '), r.notes]),
]
  .map((line) => line.map(cell).join(','))
  .join('\r\n')
writeFileSync(`${OUT}.csv`, `﻿${csv}\r\n`)

const commit = execSync('git rev-parse HEAD').toString().trim()
const branch = execSync('git branch --show-current').toString().trim()
const kinds = [...rows.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
const newCount = rows.filter((r) => r.notes.includes(PASS_NOTE)).length
const withHebrew = new Set(all.map((r) => r.file)).size

const readme = `# Hebrew copy catalog — XTRA Sign

Inventory of every Hebrew user-facing string in the product, for hand-off to a copy editor.
Regenerate with \`npx tsx scripts/product/copy-catalog.ts\`.

## Files

- \`hebrew-copy-catalog.json\` — the catalog, a plain JSON array of rows (${rows.length} rows).
- \`hebrew-copy-catalog.csv\` — the same rows, UTF-8 with BOM (opens correctly in Excel), CRLF line ends, all fields quoted; \`variables\` joined with \` | \`.
- this README — counts and method.

## Snapshot

- branch: ${branch}
- commit: ${commit}
- snapshot: ${new Date().toISOString()}
- rows marked "${PASS_NOTE}": **${newCount}** (text not present in the last commit's version of the file — the uncommitted UX-pass edits — or carried forward from the previous catalog); rows committed earlier but absent from the previous catalog are noted "not in previous catalog".

Locations (\`file\` + \`line\`) refer to the working tree at the snapshot, uncommitted UX-pass edits included.

## Counts

- Rows: **${rows.length}** (one row per distinct Hebrew text; repeats are listed in \`notes\` as "same text also at").
- Source files scanned: ${files.length} \`.ts/.tsx\` files under \`src/app\`, \`src/components\`, \`src/lib\`, \`src/server\` (tests excluded); ${withHebrew} of them contain Hebrew.
- Excluded on purpose: the agreement's own contract text (\`src/app/[slug]/AgreementText.tsx\`, the \`AgreementTerms\` body) — legal text of the agreement, not product copy; the XTRA AI system prompt and tool descriptions (\`src/server/ai/\`) — instructions to the model.
- Distinct screens named in \`screen\`: ${new Set(rows.map((r) => r.screen)).size}.

### Rows per kind

| kind | rows |
|---|---|
${kinds.map(([k, n]) => `| ${k} | ${n} |`).join('\n')}

## Row shape

| field | meaning |
|---|---|
| \`text\` | the Hebrew exactly as it is in code. Interpolations are kept as written: \`{{signer_name}}\` (message templates), \`\${name}\` (template literals), \`{expr}\` (JSX). \`<b>…</b>\`, \`<Link>…</Link>\` mark inline markup inside one sentence. |
| \`file\`, \`line\` | the representative occurrence (the first in file order). |
| \`screen\` | where a person sees it — screen, mail, SMS, PDF page. Names come from the previous catalog where the file was already known, otherwise from the file's folder. |
| \`kind\` | a heuristic from the syntactic context (tag chain, attribute, enclosing call, property name, text patterns): nav, heading, tab, button, label, placeholder, help, error, success, empty_state, dialog, status, step, setting, report, email_subject, email_body, sms, public_page, aria, legal, other. Strong hint, not a hand review. |
| \`variables\` | placeholders that must not change. |
| \`notes\` | "${PASS_NOTE}", glossary terms present, other occurrences of the same text. |

## The rule for editing

**Variables and functional meaning must not change; only the Hebrew text is editable.**

- Placeholders in \`variables\` must appear in the edited text exactly as written (order may change; none may be dropped).
- Rows typed \`legal\`, \`sms\` and \`public_page\` must not change meaning without approval.
- Glossary terms (${GLOSSARY.join(', ')}) are flagged in \`notes\` — keep them consistent across all rows.
- Rows that share a \`file\` + \`line\` are gender / number / state variants of one sentence — edit them together.

## Method

1. **Extraction** (\`scripts/product/copy-catalog.ts\`): every \`.ts/.tsx\` file under the four source roots is parsed with the TypeScript compiler API. Collected: string literals, template literals (placeholders kept as \`\${…}\`), JSX text, and JSX attributes containing Hebrew letters (U+0590–U+05FF). A paragraph mixing JSX text with inline expressions or inline tags (\`<b>\`, \`<span>\`, \`<Link>\` …) is captured as one sentence with \`{…}\` placeholders, so the editor sees whole sentences; the literals inside those expressions are still listed as their own rows. Comments never enter.
2. **Exclusions**: \`__tests__\`, \`*.test.ts\`, \`src/test\`, \`src/labs\`; \`console.*\` / logger calls; import / export specifiers, type literals, object keys and element-access keys; the agreement contract and the AI prompt named above.
3. **Dedupe**: by exact text; the first occurrence in file order is the representative, the rest go to \`notes\`.
4. **Change marker**: each file is also extracted from \`git show HEAD:<file>\`; a text absent there is uncommitted work and is noted "${PASS_NOTE}". Rows that already carried the note in the previous catalog keep it, so the marker survives a regeneration after the commit. A text that is committed but was not in the previous catalog is noted "not in previous catalog".
5. **Checks**: the CSV parses back to the same number of rows with 7 columns and identical texts.

## Not covered / caveats

- The XTRA AI assistant's free-form replies are generated and cannot be catalogued.
- The signed PDF's agreement body is the user's own uploaded document; only system-generated text is listed.
- Public assets (\`public/**\` title images) carry Hebrew as pixels; their \`alt\` texts are in the catalog (\`kind: aria\`).
- Sentences assembled at runtime from several pieces appear as several rows.
`
writeFileSync(`${OUT}.README.md`, readme)

// ponytail: the one check — the CSV round-trips to the same rows.
const parsed = readFileSync(`${OUT}.csv`, 'utf8').slice(1).split('\r\n').filter(Boolean).length - 1
if (parsed !== rows.length) throw new Error(`CSV has ${parsed} rows, JSON has ${rows.length}`)
console.log(`${rows.length} rows (${newCount} marked "${PASS_NOTE}") from ${files.length} files → ${OUT}.{json,csv,README.md}`)
