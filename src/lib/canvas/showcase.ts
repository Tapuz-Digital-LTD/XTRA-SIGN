import type { CanvasDocument } from './model'

/**
 * A finished, professional design the editor can start from.
 *
 * This is what "a document from a serious company" looks like: a cover with a
 * full-bleed colour field and typographic hierarchy, an agreement page with a
 * details table bound to the recipient's own data, and a signing page whose
 * fields sit where a signer expects them. It exists so the first document
 * anyone makes — or shows their boss — starts from craft rather than from a
 * blank page.
 *
 * Every value here is plain model data. Loading it costs nothing and touches
 * no server, which is also what makes it a safe one-click demo.
 */

const TEAL = '#0e7490'
const DARK = '#155e75'
const AMBER = '#f59e0b'
const INK = '#0f172a'
const SOFT = '#64748b'

export function tourismShowcase(): CanvasDocument {
  let z = 0
  const layer = () => ++z

  return {
    version: 1,
    title: 'הסכם השתתפות — חודש התיירות 2026',
    pages: [
      // ── Page 1: cover ────────────────────────────────────────────────
      {
        id: 'cover',
        background: { color: '#ffffff' },
        elements: [
          // A deep colour field over the top two thirds, with a warm accent
          // bar where it meets the white — the page reads designed, not typed.
          { id: 'cv-bg', kind: 'rect', x: 0, y: 0, width: 210, height: 190, zIndex: layer(), name: 'רקע עליון', locked: true, style: { fill: TEAL } },
          { id: 'cv-bg2', kind: 'rect', x: 0, y: 150, width: 210, height: 40, zIndex: layer(), name: 'גוון עומק', locked: true, style: { fill: DARK, opacity: 0.45 } },
          { id: 'cv-accent', kind: 'rect', x: 0, y: 188, width: 210, height: 2.5, zIndex: layer(), name: 'פס הדגשה', locked: true, style: { fill: AMBER } },
          // Decorative circles, echoing sun and sea without a stock photo.
          { id: 'cv-sun', kind: 'rect', x: 150, y: 22, width: 34, height: 34, zIndex: layer(), name: 'עיגול דקורטיבי', style: { fill: AMBER, borderRadius: 17, opacity: 0.9 } },
          { id: 'cv-ring', kind: 'rect', x: 12, y: 118, width: 56, height: 56, zIndex: layer(), name: 'טבעת', style: { fill: 'transparent', borderColor: '#ffffff', borderWidth: 0.8, borderRadius: 28, opacity: 0.35 } },

          { id: 'cv-brand', kind: 'text', x: 24, y: 26, width: 80, height: 12, zIndex: layer(), name: 'לוגו XTRA', text: 'XTRA', binding: 'organization.legal_name', style: { fontSize: 26, fontWeight: 'bold', color: '#ffffff', align: 'right' } },
          { id: 'cv-brand-sub', kind: 'text', x: 24, y: 38, width: 80, height: 7, zIndex: layer(), name: 'תת מותג', text: 'GIFT CARD', style: { fontSize: 10, color: '#ffffff', align: 'right', letterSpacing: 3, direction: 'ltr' } },

          { id: 'cv-kicker', kind: 'text', x: 24, y: 92, width: 162, height: 8, zIndex: layer(), name: 'שורת פתיחה', text: 'חודש התיירות • קיץ 2026', style: { fontSize: 13, color: '#fef3c7', align: 'right', fontWeight: 'bold' } },
          { id: 'cv-title', kind: 'text', x: 24, y: 102, width: 162, height: 34, zIndex: layer(), name: 'כותרת ראשית', text: 'הסכם השתתפות\nבמבצע ההטבות', style: { fontSize: 34, fontWeight: 'bold', color: '#ffffff', align: 'right', lineHeight: 1.15 } },
          { id: 'cv-sub', kind: 'text', x: 24, y: 140, width: 162, height: 16, zIndex: layer(), name: 'כותרת משנה', text: 'שיתוף פעולה עם בתי עסק מובילים בענף התיירות,\nהנופש והחוויות ברחבי הארץ', style: { fontSize: 13, color: '#e0f2fe', align: 'right', lineHeight: 1.5 } },

          { id: 'cv-for-label', kind: 'text', x: 24, y: 208, width: 60, height: 8, zIndex: layer(), name: 'תווית עבור', text: 'נערך עבור', style: { fontSize: 10, color: SOFT, align: 'right' } },
          { id: 'cv-company', kind: 'text', x: 24, y: 216, width: 120, height: 12, zIndex: layer(), name: 'שם הספק', text: 'שם בית העסק', binding: 'company.name', style: { fontSize: 20, fontWeight: 'bold', color: INK, align: 'right' } },
          { id: 'cv-date-label', kind: 'text', x: 24, y: 236, width: 60, height: 7, zIndex: layer(), name: 'תווית תאריך', text: 'תאריך', style: { fontSize: 10, color: SOFT, align: 'right' } },
          { id: 'cv-date', kind: 'text', x: 24, y: 243, width: 60, height: 9, zIndex: layer(), name: 'תאריך', text: '01.06.2026', binding: 'today', style: { fontSize: 13, color: INK, align: 'right' } },
          { id: 'cv-rule', kind: 'line', x: 24, y: 258, width: 162, height: 0.4, zIndex: layer(), name: 'קו תחתון', style: { fill: '#cbd5e1' } },
          { id: 'cv-footer', kind: 'text', x: 24, y: 264, width: 162, height: 7, zIndex: layer(), name: 'שורת תחתית', text: 'מסמך זה נערך ונחתם דיגיטלית באמצעות XTRA Sign', style: { fontSize: 9, color: SOFT, align: 'center' } },
        ],
      },

      // ── Page 2: the agreement ────────────────────────────────────────
      {
        id: 'body',
        background: { color: '#ffffff' },
        elements: [
          { id: 'b-head-bar', kind: 'rect', x: 0, y: 0, width: 210, height: 16, zIndex: layer(), name: 'פס כותרת', locked: true, style: { fill: TEAL } },
          { id: 'b-head', kind: 'text', x: 16, y: 4, width: 120, height: 8, zIndex: layer(), name: 'כותרת עמוד', text: 'הסכם השתתפות — חודש התיירות 2026', style: { fontSize: 10, color: '#ffffff', align: 'right', fontWeight: 'bold' } },
          { id: 'b-page-no', kind: 'text', x: 178, y: 4, width: 16, height: 8, zIndex: layer(), name: 'מספר עמוד', text: '2', style: { fontSize: 10, color: '#a5f3fc', align: 'left', direction: 'ltr' } },

          { id: 'b-h1', kind: 'text', x: 16, y: 26, width: 178, height: 10, zIndex: layer(), name: 'הצדדים', text: '1. הצדדים להסכם', style: { fontSize: 15, fontWeight: 'bold', color: DARK, align: 'right' } },
          { id: 'b-p1', kind: 'text', x: 16, y: 37, width: 178, height: 24, zIndex: layer(), name: 'פסקת פתיחה', text: 'הסכם זה נערך בין תפוזנט בע"מ, המפעילה את מותג XTRA Gift Card (להלן: "החברה"), ובין בית העסק ששמו ופרטיו מופיעים בטבלה שלהלן (להלן: "בית העסק"), במסגרת מבצע ההטבות של חודש התיירות 2026.', style: { fontSize: 11, color: INK, align: 'justify', lineHeight: 1.6 } },

          { id: 'b-h2', kind: 'text', x: 16, y: 66, width: 178, height: 10, zIndex: layer(), name: 'פרטי בית העסק', text: '2. פרטי בית העסק', style: { fontSize: 15, fontWeight: 'bold', color: DARK, align: 'right' } },
          { id: 'b-table', kind: 'table', x: 16, y: 77, width: 178, height: 60, zIndex: layer(), name: 'טבלת פרטים', headers: ['פרט', 'ערך'], rows: [
            ['שם בית העסק', ''],
            ['ח.פ / ע.מ', ''],
            ['כתובת', ''],
            ['איש קשר', ''],
            ['טלפון', ''],
            ['אימייל', ''],
          ], style: { headerFill: '#ecfeff', headerColor: DARK, borderColor: '#94a3b8', fontSize: 10, columnWidths: [55, 123] } },

          { id: 'b-h3', kind: 'text', x: 16, y: 142, width: 178, height: 10, zIndex: layer(), name: 'מהות ההסכם', text: '3. מהות שיתוף הפעולה', style: { fontSize: 15, fontWeight: 'bold', color: DARK, align: 'right' } },
          { id: 'b-p3', kind: 'text', x: 16, y: 153, width: 178, height: 34, zIndex: layer(), name: 'פסקת מהות', text: 'בית העסק יכבד שוברי XTRA כאמצעי תשלום מלא, ויעניק למחזיקי השוברים את ההטבות שסוכמו במסגרת המבצע. החברה תכלול את בית העסק בפרסומי המבצע, בערוצי השיווק שלה ובאפליקציית XTRA, ותעביר לבית העסק את התמורה בהתאם לתנאי הסליקה המפורטים בנספח א׳.', style: { fontSize: 11, color: INK, align: 'justify', lineHeight: 1.6 } },

          // A callout that summarises the deal in one glance.
          { id: 'b-callout', kind: 'rect', x: 16, y: 190, width: 178, height: 26, zIndex: layer(), name: 'תיבת הדגשה', style: { fill: '#fffbeb', borderColor: AMBER, borderWidth: 0.5, borderRadius: 2 } },
          { id: 'b-callout-t', kind: 'text', x: 22, y: 195, width: 166, height: 17, zIndex: layer(), name: 'טקסט הדגשה', text: 'עיקרי המבצע: תקופת פעילות 01.06–31.08.2026 • עמלת סליקה מופחתת • חשיפה למאות אלפי מחזיקי שוברים', style: { fontSize: 11, fontWeight: 'bold', color: '#92400e', align: 'right', lineHeight: 1.5 } },

          { id: 'b-h4', kind: 'text', x: 16, y: 224, width: 178, height: 10, zIndex: layer(), name: 'תנאים כלליים', text: '4. תנאים כלליים', style: { fontSize: 15, fontWeight: 'bold', color: DARK, align: 'right' } },
          { id: 'b-p4', kind: 'text', x: 16, y: 235, width: 178, height: 40, zIndex: layer(), name: 'פסקת תנאים', text: 'תוקף ההסכם למשך תקופת המבצע בלבד. כל צד רשאי לסיים את ההתקשרות בהודעה מוקדמת של 14 ימי עסקים. בית העסק מתחייב לרמת שירות נאותה כלפי מחזיקי השוברים, והחברה מתחייבת להעברת התמורה במועדים שסוכמו. על הסכם זה יחולו דיני מדינת ישראל.', style: { fontSize: 11, color: INK, align: 'justify', lineHeight: 1.6 } },

          { id: 'b-foot-rule', kind: 'line', x: 16, y: 282, width: 178, height: 0.3, zIndex: layer(), name: 'קו תחתון', style: { fill: '#cbd5e1' } },
          { id: 'b-foot', kind: 'text', x: 16, y: 285, width: 178, height: 6, zIndex: layer(), name: 'כותרת תחתונה', text: 'XTRA Gift Card • הסכם השתתפות חודש התיירות 2026', style: { fontSize: 8, color: SOFT, align: 'center' } },
        ],
      },

      // ── Page 3: signatures ───────────────────────────────────────────
      {
        id: 'sign',
        background: { color: '#ffffff' },
        elements: [
          { id: 's-head-bar', kind: 'rect', x: 0, y: 0, width: 210, height: 16, zIndex: layer(), name: 'פס כותרת', locked: true, style: { fill: TEAL } },
          { id: 's-head', kind: 'text', x: 16, y: 4, width: 120, height: 8, zIndex: layer(), name: 'כותרת עמוד', text: 'הסכם השתתפות — חתימות', style: { fontSize: 10, color: '#ffffff', align: 'right', fontWeight: 'bold' } },

          { id: 's-h1', kind: 'text', x: 16, y: 30, width: 178, height: 10, zIndex: layer(), name: 'כותרת חתימות', text: 'ולראיה באו הצדדים על החתום', style: { fontSize: 16, fontWeight: 'bold', color: DARK, align: 'center' } },
          { id: 's-note', kind: 'text', x: 16, y: 42, width: 178, height: 8, zIndex: layer(), name: 'הסבר', text: 'בחתימתו מאשר בית העסק כי קרא את ההסכם, הבין את תנאיו והוא מסכים להם.', style: { fontSize: 10, color: SOFT, align: 'center' } },

          { id: 's-card', kind: 'rect', x: 30, y: 58, width: 150, height: 96, zIndex: layer(), name: 'כרטיס חתימה', style: { fill: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 0.4, borderRadius: 3 } },

          { id: 's-name-l', kind: 'text', x: 40, y: 66, width: 40, height: 8, zIndex: layer(), name: 'תווית שם', text: 'שם מלא', style: { fontSize: 11, fontWeight: 'bold', color: INK, align: 'right' } },
          { id: 's-name', kind: 'field', x: 40, y: 75, width: 90, height: 9, zIndex: layer(), fieldType: 'full_name', label: 'שם מלא', name: 'שדה שם', required: true },

          { id: 's-date-l', kind: 'text', x: 40, y: 92, width: 40, height: 8, zIndex: layer(), name: 'תווית תאריך', text: 'תאריך', style: { fontSize: 11, fontWeight: 'bold', color: INK, align: 'right' } },
          { id: 's-date', kind: 'field', x: 40, y: 101, width: 45, height: 9, zIndex: layer(), fieldType: 'date', label: 'תאריך', name: 'שדה תאריך', required: true },

          { id: 's-sig-l', kind: 'text', x: 40, y: 118, width: 40, height: 8, zIndex: layer(), name: 'תווית חתימה', text: 'חתימה וחותמת', style: { fontSize: 11, fontWeight: 'bold', color: INK, align: 'right' } },
          { id: 's-sig', kind: 'field', x: 40, y: 127, width: 75, height: 20, zIndex: layer(), fieldType: 'signature', label: 'חתימה', name: 'שדה חתימה', required: true },

          { id: 's-accent', kind: 'rect', x: 0, y: 285, width: 210, height: 12, zIndex: layer(), name: 'פס סיום', locked: true, style: { fill: TEAL } },
          { id: 's-foot', kind: 'text', x: 16, y: 288, width: 178, height: 6, zIndex: layer(), name: 'שורת סיום', text: 'נחתם דיגיטלית באמצעות XTRA Sign', style: { fontSize: 8, color: '#ffffff', align: 'center' } },
        ],
      },
    ],
  }
}
