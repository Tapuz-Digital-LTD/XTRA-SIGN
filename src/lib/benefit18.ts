/**
 * הטבת 18 ₪ — a separate track of the tourism campaign, chosen per
 * invitation like the hotels' call: its own form, its own terms and its own
 * document, "הסכם שיתוף פעולה — הטבת 18 ₪", on the campaign's letterhead
 * like the regular agreement. The signed file says what the form says and
 * nothing the form does not (owner, 2026-10-08): the Tapuznet supplier
 * agreement that once followed it as an appendix left the screen and the
 * document together.
 *
 * One source for the joining form and the PDF generator
 * (scripts/design/benefit18.ts).
 */

export const BENEFIT18_TITLE = 'הסכם שיתוף פעולה — הטבת 18 ₪'
export const BENEFIT18_SUBTITLE = 'השתתפות בהטבת 18 ₪: חודש התיירות הישראלית - נובמבר 2026'
export const BENEFIT18_JOIN_CLAUSE = 'בית העסק מביע בזאת את רצונו להצטרף כבית עסק משתתף בהטבת 18 ₪ במסגרת פרויקט "חודש התיירות הישראלית" שיתקיים בחודש נובמבר 2026'
export const BENEFIT18_BENEFIT_CLAUSE = 'בית העסק יעניק מחיר מיוחד עבור חודש התיירות, הנמוך מהמחיר המפורסם באתר בית העסק, עבור לקוחות שיגיעו דרך הפרסום באתר המיזם.'
/** How the 18 ₪ voucher works — the owner's words, 2026-10-08. */
export const BENEFIT18_VOUCHER_NOTE = [
  'הלקוח ישלם ל־xtra 18 ₪ עבור הפעילות המוצעת ויגיע לבית העסק עם מספר שובר. בית העסק יממש את השובר באמצעות ממשק הספקים, אשר יועבר אליו בצירוף פרטי משתמש.',
  'בסיום הפעילות יעביר בית העסק ל־xtra דוח מפורט של כלל השוברים שמומשו בפועל, לצורך ביצוע התשלום בהתאם.',
]
/** "תנאים והגבלות למימוש ההטבה" of this track: of the regular five, the only one that holds (owner, 2026-10-08). */
export const BENEFIT18_TERMS = ['הענקת ההטבה מותנית בהצגת הקופון / הזנת קוד הקופון בבית העסק.']
export const BENEFIT18_PRICES_NOTE = 'המחירים הינם נטו וכוללים מע״מ.'
/** What the bank account is for — the same words on the form and on the document. */
export const BENEFIT18_BANK_CLAUSE = 'לתשלום עבור השוברים שמומשו בבית העסק, לאחר קבלת חשבונית ובתנאי שוטף+45 יום.'

/**
 * The banks a business account in Israel is held at, by their clearing
 * number (Bank of Israel). Anything else is typed in as "בנק אחר".
 */
export const ISRAELI_BANKS = [
  { number: '12', name: 'בנק הפועלים' },
  { number: '10', name: 'בנק לאומי' },
  { number: '11', name: 'בנק דיסקונט' },
  { number: '20', name: 'בנק מזרחי טפחות' },
  { number: '31', name: 'הבנק הבינלאומי הראשון' },
  { number: '17', name: 'בנק מרכנתיל דיסקונט' },
  { number: '54', name: 'בנק ירושלים' },
  { number: '46', name: 'בנק מסד' },
  { number: '52', name: 'בנק פועלי אגודת ישראל' },
  { number: '4', name: 'בנק יהב' },
  { number: '9', name: 'בנק הדואר' },
  { number: '18', name: 'וואן זירו הבנק הדיגיטלי' },
] as const
