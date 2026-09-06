# בקשה לתמיכת Inforu — הפעלת יכולות לחשבון XTRA Sign

> מכתב אחד לתמיכה. הכול מבוסס על התיעוד הרשמי (אוסף ה-Postman של Inforu, `docs/integrations/inforu-campaigns.md`). עד שהיכולות יופעלו המערכת עובדת עם ה-Pull fallbacks ומציגה "הנתון עדיין לא זמין" במקום 0.

---

שלום צוות Inforu,

אנחנו מפעילים את חשבון XTRA (שם משתמש API: `<BASE_CREDENTIALS user>` — לא לכלול סיסמה במייל) מתוך מערכת XTRA Sign, ומבקשים להפעיל/לאשר לחשבון את היכולות הבאות המופיעות בתיעוד ה-API שלכם:

1. **SMS — Push DLR (Delivery Notification)**
   הפעלת דחיפת סטטוסי מסירה (DLR) לכתובת ה-Webhook שלנו:
   `https://<production host>/api/inforu/dlr`
   פורמט: כפי שמתועד ב-"Delivery Notification (Push)". עד להפעלה אנחנו מושכים סטטוסים דרך `PullData`.

2. **Email — GetMailNotification (Pull)**
   אישור לחשבון לשימוש ב-`Umail/GetMailNotification` לקבלת אירועי Delivered / Open / Click / Bounce / Unsubscribe עבור שליחות `Umail/Message/Send` עם `CampaignRefId`.

3. **Email — Unsubscribe Push**
   הפעלת דחיפת אירועי הסרה (Unsubscribe) ל-Webhook:
   `https://<production host>/api/inforu/unsubscribe`

4. **SMS Sender IDs**
   אישור מזהי השולח הבאים ב-Whitelist (מאומתים אצלנו דרך `SMS/Whitelist/SenderIdIsAllowed`):
   - `XTRA`
   - `<sender 2, אם נדרש>`

5. **Email From / Reply-To**
   אישור כתובות השולח (From) ו-Reply-To הבאות לחשבון:
   - `<SIGN_EMAIL_SENDER>` (From)
   - `tour@xtra.co.il` (Reply-To לקמפיינים)

6. **Rate limit**
   אישור שהחשבון עומד במגבלת 30 בקשות/שנייה כפי שמתועד, או עדכון אם המגבלה לחשבון שונה.

נשמח לאישור בכתב לכל סעיף, ולכל פרט טכני נוסף (למשל IP-ים ממנו נשלחות ה-Push הודעות, לצורך Allow-list).

תודה,
צוות XTRA Sign

---

## מה קורה עד לאישור

| יכולת | Fallback במערכת | מה המסך מציג |
|---|---|---|
| SMS DLR | `PullData` בפולינג | "מסירה: הנתון עדיין לא זמין" עד שיש נתון |
| Email events | `Umail/Campaign/Job` + `GetMailNotification` כשיאושר | "פתיחות/קליקים: הנתון עדיין לא זמין" |
| Unsubscribe | `Contacts/CheckIfUnsubscribe` (עד 100 בבקשה) לפני כל הפצה | נמענים מוסרים מסומנים "דולגו" |
