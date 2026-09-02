import { getOrganizationProfile, letterhead } from '@/server/organization/profile'
import { saveComposedDocument } from '@/server/documents/composer-save'
import { defineTool, schema, str, strList } from '../registry'

/**
 * Writing and designing documents.
 *
 * The assistant does not hand over a blob of HTML and hope. It composes a
 * document from named sections and a named theme, which keeps three promises
 * that matter for a contract: the signature fields are real XTRA Sign fields
 * rather than drawn boxes, the branding comes from the organization's own
 * settings rather than from a prompt, and a legal document never turns into a
 * poster — the theme changes colour, weight and spacing, never legibility.
 */

/**
 * Directions the assistant may choose between when the user has not specified
 * one. Each is a palette and a set of weights, not a layout: the structure of
 * an agreement is the same whoever it is for.
 */
const THEMES = {
  corporate: { primary: '#1e3a5f', accent: '#2563eb', tint: '#eff6ff', heading: 700 },
  tourism: { primary: '#0e7490', accent: '#f59e0b', tint: '#ecfeff', heading: 700 },
  summer: { primary: '#0369a1', accent: '#fb923c', tint: '#fff7ed', heading: 700 },
  premium: { primary: '#1c1917', accent: '#a16207', tint: '#fafaf9', heading: 600 },
  minimal: { primary: '#0f172a', accent: '#475569', tint: '#f8fafc', heading: 600 },
  government: { primary: '#14532d', accent: '#166534', tint: '#f0fdf4', heading: 700 },
  friendly: { primary: '#7c3aed', accent: '#ec4899', tint: '#faf5ff', heading: 700 },
} as const

export type ThemeName = keyof typeof THEMES

const FIELD_MARKUP: Record<string, string> = {
  signature: 'חתימה',
  full_name: 'שם מלא',
  date: 'תאריך',
  text: 'טקסט',
}

/** A field the signer fills, as the marker the renderer measures. */
function fieldSpan(type: string, index: number): string {
  const key = `XA${String(index).padStart(4, '0')}`
  return `<span data-xtra-field="${type}" data-xtra-key="${key}" style="display:inline-block;min-width:9rem;border-bottom:1px solid #333;">⁣${key}⁣</span>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

export type Section =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'callout'; text: string }
  | { type: 'page_break' }
  | { type: 'signature_block'; fields: string[] }

/**
 * Turns the assistant's sections into the document HTML.
 *
 * Written here rather than by the model so that every document has the same
 * bones: escaped text, a real field marker for every signature, and no way for
 * generated content to become markup.
 */
export function composeHtml(input: {
  title: string
  intro?: string
  sections: Section[]
  theme: ThemeName
  letterheadLines: string[]
  logoUrl?: string | null
  footer?: string | null
  brandPrimary?: string | null
  brandAccent?: string | null
}): string {
  const palette = THEMES[input.theme] ?? THEMES.corporate
  const primary = input.brandPrimary ?? palette.primary
  const accent = input.brandAccent ?? palette.accent
  let fieldIndex = 0

  const head = `
    <div style="border-bottom:3px solid ${primary};padding-bottom:10pt;margin-bottom:16pt;">
      ${input.logoUrl ? `<img src="${escapeHtml(input.logoUrl)}" alt="" style="max-height:56pt;margin-bottom:8pt;" />` : ''}
      <div style="font-size:9pt;color:#475569;line-height:1.5;">
        ${input.letterheadLines.map((line) => escapeHtml(line)).join('<br/>')}
      </div>
    </div>
    <h1 style="color:${primary};font-weight:${palette.heading};border-inline-start:5pt solid ${accent};padding-inline-start:10pt;">
      ${escapeHtml(input.title)}
    </h1>
    ${input.intro ? `<p style="color:#334155;font-size:12.5pt;">${escapeHtml(input.intro)}</p>` : ''}
  `

  const body = input.sections
    .map((section) => {
      switch (section.type) {
        case 'heading':
          return `<h2 style="color:${primary};font-weight:${palette.heading};">${escapeHtml(section.text)}</h2>`
        case 'paragraph':
          return `<p>${escapeHtml(section.text)}</p>`
        case 'list':
          return `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        case 'callout':
          return `<div style="background:${palette.tint};border-inline-start:4pt solid ${accent};padding:8pt 10pt;margin:10pt 0;">${escapeHtml(section.text)}</div>`
        case 'table':
          return `<table><thead><tr>${section.headers
            .map((header) => `<th style="background:${palette.tint};color:${primary};">${escapeHtml(header)}</th>`)
            .join('')}</tr></thead><tbody>${section.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        case 'page_break':
          return '<div data-page-break="true"></div>'
        case 'signature_block':
          return `
            <div style="margin-top:24pt;border-top:1px solid #cbd5e1;padding-top:12pt;">
              <h3 style="color:${primary};">ולראיה באו הצדדים על החתום</h3>
              <table style="border:0;">
                <tbody>
                  ${section.fields
                    .map((type) => {
                      fieldIndex += 1
                      return `<tr><td style="border:0;width:30%;padding:6pt 0;">${escapeHtml(
                        FIELD_MARKUP[type] ?? type,
                      )}:</td><td style="border:0;padding:6pt 0;">${fieldSpan(type, fieldIndex)}</td></tr>`
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          `
        default:
          return ''
      }
    })
    .join('\n')

  const foot = input.footer
    ? `<div style="margin-top:20pt;border-top:1px solid #e2e8f0;padding-top:6pt;font-size:8.5pt;color:#64748b;">${escapeHtml(input.footer)}</div>`
    : ''

  return `${head}${body}${foot}`
}

export const getBrandKit = defineTool<Record<string, never>>({
  name: 'get_brand_kit',
  description:
    'The organization’s own details and brand: legal name, company number, address, contact, logo and colours. Always read this before designing a document — never invent these values.',
  risk: 'safe',
  input: schema({}),
  async run(_input, { session }) {
    const profile = await getOrganizationProfile(session)
    const missing = [
      profile.legalName ? null : 'שם משפטי',
      profile.taxId ? null : 'ח.פ',
      profile.address ? null : 'כתובת',
      profile.logoUrl ? null : 'לוגו',
    ].filter(Boolean)

    return {
      summary: missing.length
        ? `פרטי הארגון חלקיים. חסר: ${missing.join(', ')}. אפשר להשלים בהגדרות.`
        : 'פרטי הארגון והמיתוג נטענו.',
      data: { kind: 'brand', profile, missing },
    }
  },
})

export const createDesignedDocument = defineTool<{
  companyId: string
  title: string
  intro?: string
  theme?: ThemeName
  sections: Section[]
}>({
  name: 'create_designed_document',
  description:
    'Write and design a document for one company and save it as a draft, with real signature fields. Choose a theme that suits the subject. Nothing is sent.',
  risk: 'safe',
  input: schema(
    {
      companyId: str('The company the document is for'),
      title: str('Document title'),
      intro: str('An opening line under the title'),
      theme: {
        type: 'string',
        enum: Object.keys(THEMES),
        description: 'Visual direction suited to the subject',
      },
      sections: {
        type: 'array',
        description:
          'The document body in order. Use signature_block with ["signature","full_name","date"] for the signing section.',
        items: { type: 'object' },
      },
    },
    ['companyId', 'title', 'sections'],
  ),
  async run(input, { session }) {
    const profile = await getOrganizationProfile(session)
    const html = composeHtml({
      title: input.title,
      intro: input.intro,
      sections: input.sections ?? [],
      theme: input.theme ?? 'corporate',
      letterheadLines: letterhead(profile),
      logoUrl: profile.logoUrl,
      footer: profile.footerText,
      brandPrimary: profile.brandPrimary,
      brandAccent: profile.brandAccent,
    })

    const result = await saveComposedDocument({
      session,
      title: input.title,
      html,
      companyId: input.companyId,
    })
    if (!result.ok) return { summary: result.message }

    return {
      summary: `נוצרה טיוטה מעוצבת: ${input.title}.`,
      target: { type: 'document', id: result.agreementId },
      data: { kind: 'link', href: `/documents/${result.agreementId}`, label: 'פתח וערוך' },
    }
  },
})
