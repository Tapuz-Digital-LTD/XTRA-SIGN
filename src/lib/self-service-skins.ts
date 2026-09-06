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
  },
] as const

export type SelfServiceSkin = (typeof SELF_SERVICE_SKINS)[number]
export type SkinKey = SelfServiceSkin['key']

export function skinByKey(key: string | null | undefined): SelfServiceSkin | null {
  return SELF_SERVICE_SKINS.find((skin) => skin.key === key) ?? null
}
