/**
 * The agreement's own words inside the form.
 *
 * The form is the agreement — every clause sits beside the control that
 * answers it (JoinAndSign.tsx). What is here is the part that is only read:
 * the terms of redemption, verbatim from the Ministry's page, and the one
 * note that is the system's rather than the document's.
 */

/**
 * The document's title and its opening paragraph — the first thing on the
 * Ministry's page, before any blank to fill. Read only: nothing here is
 * typed, and nothing here reaches the PDF, which already carries it.
 */
export function AgreementPreamble() {
  return (
    <section className="tj-card" aria-labelledby="tj-agreement-heading">
      <h2 id="tj-agreement-heading" className="tj-h2">הסכם לחתימת בית העסק</h2>
      <p className="tj-clause">
        חודש התיירות הישראלית הוא יוזמה לאומית של משרד התיירות בהפקת חברת בנדה הפקות, שמטרתה לחשוף את הקהל הרחב לעושר התרבותי, ההיסטורי והנופי של ישראל. במהלך החודש יתקיימו מאות סיורים ופעילויות ברחבי הארץ במחירים מסובסדים, במטרה לעודד תיירות פנים ולחזק את עסקי התיירות המקומיים. כל שבוע מוקדש לאזור אחר בארץ, והפעילויות מתקיימות מיום רביעי עד שבת.
      </p>
    </section>
  )
}

/** "תנאים והגבלות למימוש ההטבה" — the five terms, word for word. */
export function AgreementTerms() {
  return (
    <ul className="tj-terms">
      <li>אין כפל מבצעים והנחות.</li>
      <li>לא ניתן לממש את ההטבה בשילוב עם הנחות או כרטיסי מועדון לקוחות.</li>
      <li>התשלום יבוצע ישירות מול בית העסק / בקופת העסק בלבד.</li>
      <li>לא תתקיים התחשבנות כספית או גבייה מול חברת XTRA; ההתקשרות הכספית היא בין הלקוח לבית העסק בלבד.</li>
      <li>הענקת ההטבה מותנית בהצגת הקופון / הזנת קוד הקופון בבית העסק.</li>
    </ul>
  )
}

/**
 * What happens next — a system note beside the agreement, not a clause of
 * it. The signed file is the Ministry's own two-page document, filled and
 * signed; this line says where it goes, which the document itself does not.
 */
export function AgreementSystemNote() {
  return (
    <p className="tj-system-note" role="note">
      לאחר החתימה הדיגיטלית ההסכם יישמר אוטומטית ועותק חתום יהיה זמין להורדה.
    </p>
  )
}
