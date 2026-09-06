/**
 * The agreement, as the Ministry wrote it.
 *
 * Verbatim from .design/tourism-2026/agreement.pdf — the legal source of
 * truth that the supplier signs and later downloads. Nothing here is
 * rewritten, shortened or "improved"; only laid out as readable RTL HTML.
 * The one line left out is the file's closing "save and email it"
 * instruction, which belongs to the paper route (see AgreementSystemNote).
 * The business's details and the signature live around this text on the
 * joining page and are stamped into the PDF's own boxes.
 */
export function AgreementText() {
  return (
    <article className="tj-agreement" aria-label="נוסח ההסכם">
      <h2 className="tj-agreement-title">הסכם שיתוף פעולה</h2>
      <p className="tj-agreement-subtitle">מתן קופון והשתתפות: חודש התיירות הישראלית - נובמבר 2026</p>

      <p>
        בית העסק מביע בזאת את רצונו להצטרף כבית עסק משתתף במסגרת פרויקט &quot;חודש התיירות הישראלית&quot; שיתקיים
        בחודש נובמבר 2026.
      </p>

      <h3>פרטי ההטבה</h3>
      <p>בית העסק יעניק הטבה בלעדית של 25% הנחה ומעלה עבור לקוחות שיגיעו דרך הפרסום באתר המיזם.</p>
      <p>
        <strong>קוד קופון להזדהות / מימוש:</strong> <span className="tj-coupon">XTRA25</span>
      </p>

      <h3>תקופת ההתחייבות</h3>
      <ul>
        <li>ההטבה הנ״ל מחייבת במהלך שבוע התיירות האזורי שבו משתתף בית העסק.</li>
        <li>
          הרחבה אופציונלית: במידה ובית העסק יבחר בכך (על פי שיקול דעתו הבלעדי), יורשה להעניק את ההטבה לכלל פעילות
          שאר האזורים בארץ לאורך כל חודש התיירות הישראלית (11.2026).
        </li>
      </ul>

      <h3>תנאים והגבלות למימוש ההטבה</h3>
      <ul>
        <li>אין כפל מבצעים והנחות.</li>
        <li>לא ניתן לממש את ההטבה בשילוב עם הנחות או כרטיסי מועדון לקוחות.</li>
        <li>התשלום יבוצע ישירות מול בית העסק / בקופת העסק בלבד.</li>
        <li>לא תתקיים התחשבנות כספית או גבייה מול חברת XTRA; ההתקשרות הכספית היא בין הלקוח לבית העסק בלבד.</li>
        <li>הענקת ההטבה מותנית בהצגת הקופון / הזנת קוד הקופון בבית העסק.</li>
      </ul>

      <h3>הצהרות ואישורים</h3>
      <ul className="tj-declarations">
        <li>
          <span className="tj-check" aria-hidden="true">
            ✓
          </span>
          הנני מצהיר/ה כי ברשות בית העסק רישיון עסק תקף כחוק.
        </li>
        <li>
          <span className="tj-check" aria-hidden="true">
            ✓
          </span>
          הנני מצהיר/ה כי ברשות בית העסק פוליסת ביטוח בתוקף.
        </li>
      </ul>
    </article>
  )
}

/**
 * What happens next — a system note beside the agreement, not a clause of
 * it. The Ministry's file ends with an instruction to save and email it,
 * which is the old paper route; the digital route replaces it, and the
 * project's template carries the same text without that line
 * (scripts/design/prepare-agreement.ts).
 */
export function AgreementSystemNote() {
  return (
    <p className="tj-system-note" role="note">
      לאחר החתימה הדיגיטלית ההסכם יישמר אוטומטית ועותק חתום יהיה זמין להורדה.
    </p>
  )
}
