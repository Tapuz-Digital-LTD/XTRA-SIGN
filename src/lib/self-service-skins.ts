/**
 * The branded page sets a self-service project can wear.
 *
 * A skin is code: the call-for-suppliers page, the joining page and the
 * thank-you page of one campaign, in that campaign's own graphic language.
 * Which project a skin serves is configuration on the project — never an id
 * in here — so the same pages can be pointed at next year's project without a
 * deploy.
 */

export const SELF_SERVICE_SKINS = [
  {
    key: 'tourism-2026',
    label: 'חודש התיירות הישראלית 2026 (משרד התיירות)',
    basePath: '/tourism-2026',
  },
] as const

export type SelfServiceSkin = (typeof SELF_SERVICE_SKINS)[number]
export type SkinKey = SelfServiceSkin['key']

export function skinByKey(key: string | null | undefined): SelfServiceSkin | null {
  return SELF_SERVICE_SKINS.find((skin) => skin.key === key) ?? null
}
