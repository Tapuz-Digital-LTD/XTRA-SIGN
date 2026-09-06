/**
 * How many SMS segments a text costs — an estimate by the GSM standard,
 * which is what a carrier bills by: 160 characters in the GSM-7 alphabet
 * (153 per segment when split), 70 in UCS-2 (67 per segment) as soon as one
 * character — any Hebrew letter — falls outside it. The provider reports
 * the real count after sending (`SegmentsNumber`); this is the number to
 * show while typing.
 */

const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'

export type SmsLength = { encoding: 'gsm7' | 'ucs2'; chars: number; segments: number; perSegment: number }

export function smsLength(text: string): SmsLength {
  let gsm = true
  let units = 0
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1
    else if (GSM7_EXT.includes(ch)) units += 2
    else {
      gsm = false
      break
    }
  }
  if (gsm) {
    const segments = units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153)
    return { encoding: 'gsm7', chars: units, segments, perSegment: segments <= 1 ? 160 : 153 }
  }
  // UCS-2 counts UTF-16 code units; an emoji outside the BMP costs two.
  const chars = text.length
  const segments = chars === 0 ? 0 : chars <= 70 ? 1 : Math.ceil(chars / 67)
  return { encoding: 'ucs2', chars, segments, perSegment: segments <= 1 ? 70 : 67 }
}
