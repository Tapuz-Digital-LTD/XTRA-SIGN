/**
 * The campaign pages built for a project.
 *
 * A skin is code: the call-for-suppliers page, the joining page and the
 * thank-you page of one campaign, in that campaign's own graphic language.
 * A developer binds a skin to a project in its configuration; the project's
 * public address (its slug) is what people see, and it is theirs to change.
 * There is no list to pick from in the UI — a campaign page exists because
 * it was built for a project.
 */

export const SELF_SERVICE_SKINS = [
  {
    key: 'tourism-2026',
    label: 'חודש התיירות הישראלית 2026',
    /** Where the campaign's static artwork lives under /public. */
    assetsPath: '/tourism-2026',
    /** The address the project gets when it goes live without one. */
    defaultSlug: 'tourism-2026',
    /** The campaign's colour, for the emails it sends. */
    brandColor: '#0c3257',
    /** What a shared link shows until the campaign sets its own. */
    share: {
      title: 'חודש התיירות הישראלית — נובמבר 2026',
      description: 'קול קורא לעסקי תיירות להצטרף למיזם: ארבעה שבועות של פעילות, בימים רביעי עד שבת. הרשמה וחתימה דיגיטלית על הסכם ההצטרפות, עד 22 בספטמבר 2026.',
      image: '/tourism-2026/og.png',
    },
    /**
     * The versions of the call page. The invitation dialog offers them, the
     * personal link carries the chosen one as `query`, and the page picks its
     * look by it. Every version leads to the same joining form.
     */
    calls: [
      { key: 'regular', label: 'רגיל', hint: 'הקול הקורא הרגיל, כפי שהוא היום.', query: '' },
      { key: 'hotel', label: 'מלונות', hint: 'הקול הקורא בעיצוב המודעה למלונות. אותו טופס ואותו הסכם.', query: 'hotel=true' },
    ],
  },
] as const

export type SelfServiceSkin = (typeof SELF_SERVICE_SKINS)[number]
export type SkinKey = SelfServiceSkin['key']

export function skinByKey(key: string | null | undefined): SelfServiceSkin | null {
  return SELF_SERVICE_SKINS.find((skin) => skin.key === key) ?? null
}

export type CallVersion = SelfServiceSkin['calls'][number]

/** The call versions a project can send, when its campaign page has more than one. */
export function callVersionsOf(skinKey: string | null | undefined): CallVersion[] {
  const skin = skinByKey(skinKey)
  return skin && skin.calls.length > 1 ? [...skin.calls] : []
}
