import {
  APPENDIX_ACCOUNTING,
  APPENDIX_INTRO,
  APPENDIX_JOINING,
  APPENDIX_PARTY,
  APPENDIX_SECTIONS,
  APPENDIX_SERVICE_CLAUSE,
  APPENDIX_SUBJECT,
  ITEM_LETTERS,
} from '@/lib/benefit18-appendix'

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

/**
 * נספח הטבת 18 ₪ — the Tapuznet agreement, to read before signing it: the
 * same words the appendix pages print (benefit18-appendix.ts), in a box of
 * its own so the form around it stays short. What the business filled in
 * stands in its place in the text; the muted lines are ours, not the
 * document's.
 */
export function AppendixTerms({ businessName }: { businessName: string }) {
  return (
    <div className="tj-doc" role="region" aria-label="נוסח נספח הטבת 18 ₪" tabIndex={0}>
      <p className="tj-doc-subject">הנדון: {APPENDIX_SUBJECT}</p>
      {APPENDIX_INTRO.map((text) => (
        <p key={text}>{text}</p>
      ))}
      <h3>{APPENDIX_JOINING.title}</h3>
      {APPENDIX_JOINING.paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
      <p>
        <b>1.</b> {businessName || 'בית העסק'} {APPENDIX_SERVICE_CLAUSE} <span className="tj-doc-note">(השירותים והמחירים שמילאתם בשלב הקודם)</span>
      </p>
      {APPENDIX_SECTIONS.map((section) => (
        <section key={section.n}>
          <h3>
            {section.n}. {section.title}
            {section.lead ? <span className="tj-doc-lead"> {section.lead}</span> : null}
          </h3>
          {section.items ? (
            <ol>
              {section.items.map((text, i) => (
                <li key={text}>
                  <span>{ITEM_LETTERS[i]}.</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {section.paragraphs?.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </section>
      ))}
      <h3>{APPENDIX_ACCOUNTING.title}</h3>
      <p>{APPENDIX_ACCOUNTING.invoice}</p>
      <p>כתובת: {APPENDIX_ACCOUNTING.address}</p>
      <p>
        איש קשר הנה״ח: {APPENDIX_ACCOUNTING.bookkeeper.name} <bdi>{APPENDIX_ACCOUNTING.bookkeeper.email}</bdi>
      </p>
      <p className="tj-doc-note">
        פרטי בית העסק ופרטי חשבון הבנק כפי שמילאתם בשלב הקודם. שם החותם והתאריך נכנסים בעת החתימה, וחתימת {APPENDIX_PARTY} מודפסת במסמך.
      </p>
    </div>
  )
}
