/**
 * Where the הטבת 18 ₪ agreement's answers go: their page and page fractions,
 * origin top-left, measured by scripts/design/benefit18.ts off the same
 * layout that printed assets/benefit18.pdf. Generated — do not edit by hand;
 * regenerate the two together.
 */
export const BENEFIT18_PAGES = 2

export const BENEFIT18_SLOTS = {
  a_business_name: { page: 1, x: 0.51429, y: 0.28226, w: 0.39334, h: 0.02087 },
  a_tax_id: { page: 1, x: 0.09237, y: 0.28226, w: 0.39336, h: 0.02087 },
  a_commercial: { page: 1, x: 0.51429, y: 0.32392, w: 0.39334, h: 0.02087 },
  a_email: { page: 1, x: 0.09237, y: 0.32392, w: 0.39336, h: 0.02087 },
  a_contact_phone: { page: 1, x: 0.51429, y: 0.36559, w: 0.39334, h: 0.02087 },
  a_address: { page: 1, x: 0.09237, y: 0.36559, w: 0.39336, h: 0.02087 },
  a_s1_type: { page: 1, x: 0.49323, y: 0.52824, w: 0.36904, h: 0.01782 },
  a_s1_tourism: { page: 1, x: 0.2901, y: 0.52824, w: 0.18285, h: 0.01782 },
  a_s1_site: { page: 1, x: 0.08696, y: 0.52824, w: 0.18287, h: 0.01782 },
  a_s2_type: { page: 1, x: 0.49323, y: 0.55382, w: 0.36904, h: 0.01782 },
  a_s2_tourism: { page: 1, x: 0.2901, y: 0.55382, w: 0.18285, h: 0.01782 },
  a_s2_site: { page: 1, x: 0.08696, y: 0.55382, w: 0.18287, h: 0.01782 },
  a_s3_type: { page: 1, x: 0.49323, y: 0.5794, w: 0.36904, h: 0.01782 },
  a_s3_tourism: { page: 1, x: 0.2901, y: 0.5794, w: 0.18285, h: 0.01782 },
  a_s3_site: { page: 1, x: 0.08696, y: 0.5794, w: 0.18287, h: 0.01782 },
  a_notes: { page: 1, x: 0.07619, y: 0.63913, w: 0.84763, h: 0.02087 },
  a_week_1: { page: 1, x: 0.89224, y: 0.82858, w: 0.0189, h: 0.01336 },
  a_week_2: { page: 1, x: 0.46368, y: 0.82858, w: 0.0189, h: 0.01336 },
  a_week_3: { page: 1, x: 0.89224, y: 0.88118, w: 0.0189, h: 0.01336 },
  a_week_4: { page: 1, x: 0.46368, y: 0.88118, w: 0.0189, h: 0.01336 },
  a_extension: { page: 1, x: 0.90491, y: 0.92752, w: 0.0189, h: 0.01336 },
  a_bank_account_name: { page: 2, x: 0.51429, y: 0.2389, w: 0.40952, h: 0.02087 },
  a_bank: { page: 2, x: 0.07619, y: 0.2389, w: 0.40954, h: 0.02087 },
  a_bank_branch: { page: 2, x: 0.51429, y: 0.28056, w: 0.40952, h: 0.02087 },
  a_bank_branch_name: { page: 2, x: 0.07619, y: 0.28056, w: 0.40954, h: 0.02087 },
  a_bank_account: { page: 2, x: 0.51429, y: 0.32223, w: 0.40952, h: 0.02087 },
  a_declare_license: { page: 2, x: 0.90491, y: 0.45126, w: 0.0189, h: 0.01336 },
  a_declare_insurance: { page: 2, x: 0.90491, y: 0.47586, w: 0.0189, h: 0.01336 },
  a_signatory: { page: 2, x: 0.51429, y: 0.54924, w: 0.40952, h: 0.02087 },
  a_role: { page: 2, x: 0.07619, y: 0.54924, w: 0.40954, h: 0.02087 },
  a_signature: { page: 2, x: 0.51429, y: 0.5909, w: 0.40952, h: 0.05387 },
  a_date: { page: 2, x: 0.07619, y: 0.5909, w: 0.40954, h: 0.02087 },
} as const

export type Benefit18Slot = keyof typeof BENEFIT18_SLOTS
