/**
 * Where the 18 ₪ appendix's answers go on its pages: page fractions, origin
 * top-left, measured by scripts/design/benefit18-appendix.ts off the same
 * layout that printed assets/benefit18-appendix.pdf. Generated — do not edit
 * by hand; regenerate the two together.
 */
export const APPENDIX_PAGES = 3

export const APPENDIX_SLOTS = {
  letter_name: { page: 1, x: 0.6143, y: 0.16633, w: 0.29524, h: 0.01782 },
  letter_address: { page: 1, x: 0.6143, y: 0.18854, w: 0.29524, h: 0.01782 },
  letter_city: { page: 1, x: 0.6143, y: 0.21076, w: 0.29524, h: 0.01782 },
  letter_contact: { page: 1, x: 0.6143, y: 0.23297, w: 0.25904, h: 0.01782 },
  letter_phone: { page: 1, x: 0.6143, y: 0.25519, w: 0.24965, h: 0.01782 },
  letter_date: { page: 1, x: 0.09046, y: 0.14836, w: 0.15812, h: 0.01782 },
  clause_name: { page: 1, x: 0.60861, y: 0.51096, w: 0.27618, h: 0.01782 },
  audience_business: { page: 1, x: 0.89568, y: 0.56104, w: 0.01386, h: 0.0098 },
  audience_private: { page: 1, x: 0.73565, y: 0.56104, w: 0.01386, h: 0.0098 },
  s1_type: { page: 1, x: 0.69824, y: 0.61182, w: 0.20053, h: 0.01782 },
  s1_details: { page: 1, x: 0.36294, y: 0.61182, w: 0.31502, h: 0.01782 },
  s1_price: { page: 1, x: 0.24027, y: 0.61182, w: 0.10239, h: 0.01782 },
  s1_net: { page: 1, x: 0.10123, y: 0.61182, w: 0.11877, h: 0.01782 },
  s2_type: { page: 1, x: 0.69824, y: 0.64213, w: 0.20053, h: 0.01782 },
  s2_details: { page: 1, x: 0.36294, y: 0.64213, w: 0.31502, h: 0.01782 },
  s2_price: { page: 1, x: 0.24027, y: 0.64213, w: 0.10239, h: 0.01782 },
  s2_net: { page: 1, x: 0.10123, y: 0.64213, w: 0.11877, h: 0.01782 },
  s3_type: { page: 1, x: 0.69824, y: 0.67243, w: 0.20053, h: 0.01782 },
  s3_details: { page: 1, x: 0.36294, y: 0.67243, w: 0.31502, h: 0.01782 },
  s3_price: { page: 1, x: 0.24027, y: 0.67243, w: 0.10239, h: 0.01782 },
  s3_net: { page: 1, x: 0.10123, y: 0.67243, w: 0.11877, h: 0.01782 },
  form_company: { page: 3, x: 0.59727, y: 0.44672, w: 0.23232, h: 0.01782 },
  form_contact: { page: 3, x: 0.31888, y: 0.44672, w: 0.15962, h: 0.01782 },
  form_tax_id: { page: 3, x: 0.09046, y: 0.44672, w: 0.16556, h: 0.01782 },
  form_mailing: { page: 3, x: 0.09046, y: 0.47416, w: 0.67978, h: 0.01782 },
  bank_account_name: { page: 3, x: 0.61649, y: 0.52446, w: 0.2121, h: 0.01782 },
  bank_branch_name: { page: 3, x: 0.35347, y: 0.52446, w: 0.17047, h: 0.01782 },
  bank_account: { page: 3, x: 0.09048, y: 0.52446, w: 0.13716, h: 0.01782 },
  bank_name: { page: 3, x: 0.61649, y: 0.5519, w: 0.22429, h: 0.01782 },
  bank_branch: { page: 3, x: 0.35347, y: 0.5519, w: 0.15413, h: 0.01782 },
  bank_number: { page: 3, x: 0.09048, y: 0.5519, w: 0.1585, h: 0.01782 },
  signatory_name: { page: 3, x: 0.46273, y: 0.60894, w: 0.36914, h: 0.01782 },
  sign_date: { page: 3, x: 0.09048, y: 0.60894, w: 0.24644, h: 0.01782 },
  signature: { page: 3, x: 0.60479, y: 0.65801, w: 0.30475, h: 0.07407 },
} as const

export type AppendixSlot = keyof typeof APPENDIX_SLOTS
