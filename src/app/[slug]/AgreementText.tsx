/**
 * The agreement's own words inside the form.
 *
 * The form is the agreement — every clause sits beside the control that
 * answers it (JoinAndSign.tsx). What is here is the part that is only read:
 * the terms of redemption, verbatim from the Ministry's page, and the one
 * note that is the system's rather than the document's.
 */

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
