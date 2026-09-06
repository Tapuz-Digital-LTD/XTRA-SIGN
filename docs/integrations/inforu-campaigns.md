# Inforu — capability matrix for campaign distributions

**Source of truth:** the official Postman collection published at
https://apidoc.inforu.co.il (collection "API InforUMobile", version tag
`latest`, fetched 2026-09-06 from
`https://apidoc.inforu.co.il/api/collections/15332030/TzeWFTF1?versionTag=latest`).
Everything below is read from that collection. Where the collection points
at an older PDF (SMS_API-6.1.pdf, XML push formats) the newer JSON
documentation was preferred. Nothing here is reverse-engineered from the
Inforu web interface.

"Verified" = present in the current official collection with request and
response examples. "Support-enabled" = documented, but the collection says
to contact Inforu support/sales to switch it on for the account.

## Account facts

| Item | What the docs say |
|---|---|
| Base URL | `https://capi.inforu.co.il/api/v2/…` (the legacy `api.inforu.co.il/…aspx` endpoints are still listed for parameters/pull-queue URLs) |
| Authentication | HTTP Basic: `Authorization: Basic base64(username:apiToken)`. Our `BASE_CREDENTIALS` env is exactly this header value (already used by `src/server/notifications/inforu.ts`) |
| Rate limit | 30 calls/second per account; over that → HTTP 429 with `Retry-After` and `StatusId -429` |
| Response envelope | `{ StatusId, StatusDescription, DetailedDescription, FunctionName, RequestId, Data }`; `StatusId 1` = success; negative = error (documented list: -1 failed, -2 bad credentials, -13/-14/-15 quota, -18 no valid recipients, -21 invalid sender, -94 sender not in allow list, -96 message > 1000 chars, -429 too many requests, -524 max SMS per minute) |
| Sender IDs | SMS `Settings.Sender` must be in the account's white list; `SMS/Whitelist/SenderIdIsAllowed` checks one. Email `FromAddress` and `ReplyAddress` must be in the account's white list |
| Quota | `Admin/GetQuota` returns remaining units — the only pricing-adjacent data documented; there is **no per-message price API** for us to show |

## Capability matrix

| Capability | Official endpoint | Auth | Request (key fields) | Response | Callback / Pull | Limits & notes | Verified |
|---|---|---|---|---|---|---|---|
| **SMS — send to list** | `POST SMS/SendSms` | Basic | `Data.Message` (personalisation `[#FirstName#] [#LastName#] [#Representative#]` + custom recipient fields), `Data.Recipients[{Phone, FirstName, LastName, CustomerMessageID, CustomerParameter, …}]`, `Settings.Sender`, `Settings.CampaignName`, `Settings.TimeToSend` (schedule), `Settings.DelayInSeconds`, `Settings.CustomerMessageID`, `Settings.DeliveryNotificationUrl`, `Settings.MaxSegments`, `Settings.IgnoreUnsubscribeCheck`, `Settings.ExpireDate`, `Settings.ShortenUrlEnable`, `Settings.AllowDuplicates` | `Data.Recipients` (count), `Data.Errors`, `RequestId` | DLR via push URL or pull (below) | Message ≤ 1000 chars (-96). Segments counted by Inforu (`SegmentsNumber` in DLR); `MaxSegments` caps cost. `ShortenUrlEnable` gives click tracking (status 6 "Clicked") | ✅ |
| **SMS — schedule** | same, `Settings.TimeToSend "yyyy-MM-dd HH:mm:ss"` | Basic | as above | as above | — | Account time zone (Israel). `SMS/DeleteFutureMessages` cancels a scheduled send by `CustomerMessageID`/`CampaignName` | ✅ |
| **SMS — cancel scheduled** | `POST SMS/DeleteFutureMessages` | Basic | identifier of the future send | envelope | — | Only future messages | ✅ |
| **SMS — delivery reports (pull)** | `POST PullData` with `Data.Type = "DeliveryNotificationSMS"`, `BatchSize` | Basic | — | `Data.List[{PullData:{PhoneNumber, Status, StatusDescription, OperatorResultId, CustomerMessageId, CustomerParam, SenderNumber, SegmentsNumber, SentMessage, NotificationDate}}]` | Pull. Requires sending with `DeliveryNotificationUrl = https://api.inforu.co.il/InsertNotificationsToPullQueue.ashx` so DLRs land in the pull queue | Once pulled, entries are removed from Inforu's queue → our sync must be idempotent and store everything it pulls. Statuses: 2 delivered, -2 not delivered, -4 blocked by Inforu, 6 clicked, -107 converted to IVR | ✅ |
| **SMS — delivery reports (push)** | HTTP POST from Inforu to our `DeliveryNotificationUrl` (JSON array, fields as above plus `InforuId`, `Price`, `BillingCodeId`, `RetriesNumber`) | none (our endpoint must validate by `CustomerMessageId` we minted) | — | — | Push | **Support-enabled**: "To configure push DLR in json format, contact the support department" | ✅ (support-enabled) |
| **SMS — sent-messages report by phone** | `POST SMS/GetSentMessages` (`Phone, FromDate, ToDate, Level`) | Basic | — | list with `DeliveryNotificationStatusId`, `TimeSent`, `NumberOfSegments`, `CustomerMessageId` | Pull | **Sales-enabled** ("please contact sales"); per-phone only — not a campaign report | ✅ (sales-enabled) |
| **SMS — "opened"** | — | — | — | — | — | **Not documented. SMS has no open tracking; only delivered / failed / clicked.** We will not show an "open rate" for SMS | n/a |
| **SMS — unsubscribe link** | `POST Admin/GetBlockLink` (`Username`, `WithPhoneNumber`) | Basic | — | `Data.BlockLink`, `Data.BlockText` ("להסרה https://…") | — | Inforu also honours reply "הסר". `IgnoreUnsubscribeCheck` exists but must stay `false` | ✅ |
| **SMS — incoming replies** | `PullData Type=ReceivingSMS` or push | Basic | — | list of received messages | Pull / push (support) | Not needed for distributions; noted for completeness | ✅ |
| **Email — send new campaign** | `POST Umail/Message/Send` | Basic | `Data.CampaignName` (required), `CampaignRefId` (our distribution id → aggregates reports), `FromAddress` (white-listed), `FromName`, `ReplyAddress` (white-listed), `Subject`, `Body` (HTML; personalisation `[#FirstName#]` etc. and `[#CustomerMessageId#]`), `ScheduledSending` (datetime), `IncludeContacts[{Email, FirstName, LastName, PhoneNumber, ContactRefId, Text1.., Number1.., Date1..}]`, `IncludeGroupNumbers/Ids`, `Exclude…`, `Attachments[{Name, Url}` or `{Name, ContentType, FileData(base64)}]`, `AllowDuplicates`, `UpdateContacts`, `IgnoreUnsubscribeCheck` (support), `EmbeddedImages` (support) | `StatusId`, **`CampaignId`**, `Recipients`, **`token`** (job token) | Job status + notifications (below) | Attachments: URL or base64; no documented size/count limit — we will enforce our own conservative cap (10 MB, 3 files) and tell the user it is ours. Contact custom fields are `Text1…`, `Number1…`, `Date1…` — arbitrary named variables are **not** documented for email; our adapter maps our variables into the body before sending (server-side render) | ✅ |
| **Email — send existing campaign (designed in Inforu)** | `POST Umail/Campaign/Send/` | Basic | `CampaignId` + recipients | `CampaignId`, `token` | same | Lets a designer-made Inforu template be reused; optional for us | ✅ |
| **Email — schedule / cancel** | `ScheduledSending` on send; `POST Umail/Campaign/Stop` (`CampaignId`) | Basic | — | envelope | — | Stop works on future campaigns only | ✅ |
| **Email — job status** | `POST Umail/Campaign/Job` (`JobToken`) | Basic | — | `Data.status`: New / Pending / Ready / Progress / Success / Failed | Pull | Poll after send until Success/Failed | ✅ |
| **Email — campaign list / get / update** | `POST Umail/Campaign/List/`, `Get/`, `Update` | Basic | — | campaign metadata | — | Read side for reconciliation | ✅ |
| **Email — recipient events (DSN, open, click, return, unsubscribe)** | `POST Umail/GetMailNotification` (`BatchSize`) | Basic | — | `Data.List[{Datetime, CampaignId, Email, Action: dsn/open/click/return/unsubscribe, Value (2.0.0/4.0.0/5.0.0, desktop/mobile, URL, reason), MoreInfo (sent/deferred), AdditionalInformation, CustomerMessageId}]` | Pull. "required to pre-set the settings in the system to store the data" (**support-enabled**). After pulling, entries are deleted from the queue | Idempotent ingestion keyed on (CampaignId, Email, Action, Datetime, Value). Opens are per event (not unique) — we compute unique opens | ✅ (support-enabled) |
| **Email — unsubscribe push** | HTTP POST from Inforu to a URL we give support (XML `<InfoMailClient><ContactsRemoved><contact email=…/>`) | none | — | — | Push (**support-enabled**) | Also visible via the Contacts unsubscribe endpoints below | ✅ (support-enabled) |
| **Email — test send** | — | — | — | — | — | **No dedicated test-send API is documented.** A test is a normal `Umail/Message/Send` to the chosen address with `CampaignRefId = "test:<distribution>"`, excluded from our statistics | n/a |
| **Contacts — create / update** | `POST Contact/CreateOrUpdateContacts` (≤ 5000 per call; >10 items → async, poll `Contact/CheckJobStatusByToken`) | Basic | `Email` or `PhoneNumber` (key), `FirstName`, `LastName`, `ContactRefId`, custom fields (`Contact/GetFields/` lists them), groups | job token / results | Pull | Optional for us: we can send `IncludeContacts` inline without syncing contacts | ✅ |
| **Contacts — groups** | `Contact/CreateOrUpdateGroup`, `DeleteGroup`, `GetGroup`, `GetGroupList` | Basic | — | — | — | Optional | ✅ |
| **Suppression — check** | `POST Contact/CheckIfUnsubscribe` (`List[{Type: Phone/Email/ContactRefId/ContactId, Value}]`, ≤ 100 per call) | Basic | — | per-item unsubscribed flag | — | **We call this before every distribution** (batched by 100) and exclude hits per channel | ✅ |
| **Suppression — list / history** | `Contact/GetUnsubscribeList`, `GetUnsubscribeHistory`, `GetUnsubscribeHistoryList` | Basic | — | list with dates/reasons | Pull | For the nightly sync of our local suppression cache | ✅ |
| **Suppression — unsubscribe / reactivate** | `POST Contact/Unsubscribe` (`UnsubscribeReason`, `Type`, `Value`, ≤ 100), `Contact/ReactivateUnsubscribe` | Basic | — | — | — | Reactivation only from an explicit admin action with a reason; never automatic | ✅ |
| **File upload (for WhatsApp templates)** | `POST Files/Upload` (`ContentType`, `FileName`, `FileData` base64, `ExpirationInMinutes`) | Basic | — | `Data.UID` | — | Documented for WhatsApp template media; **email attachments use the `Attachments` array instead** | ✅ (not used by us) |
| **OTP** | `POST Otp/SendOtp`, `Otp/Authenticate`; `SMS/Whitelist/SendOtp` | Basic | — | — | — | Our OTP engine is XTRA Sign's own (existing `signing/otp.ts` sends through `SMS/SendSms`); unchanged | ✅ (not adopted) |
| **WhatsApp** | `WhatsApp/SendWhatsApp`, templates, chats | Basic | — | — | — | **Out of scope now** (per product decision) | ✅ (not in scope) |

## What the reports can honestly show

| Channel | Sent | Delivered | Opened | Clicked | Failed / bounced | Unsubscribed |
|---|---|---|---|---|---|---|
| SMS | our send count | DLR status 2 | **not measurable** | DLR status 6 (only with `ShortenUrlEnable`) | DLR -2 / -4 with `StatusDescription` | via suppression list |
| Email | `Recipients` from send + job status | `dsn` 2.0.0 | `open` events (unique by email) | `click` events (URL in `Value`) | `dsn` 4.x/5.x, `return` | `unsubscribe` events |

Everything after the click — page views, registrations, signatures — comes
from XTRA Sign's own tables and campaign events, joined by UTM
(`utm_source=inforu`, `utm_medium=sms|email`, `utm_campaign=<campaign>`,
`utm_content=<distribution>`) and by the registration itself.

## Existing integration to reuse (inventory)

| Piece | Where | Notes |
|---|---|---|
| Credentials, base URL, timeout, 3 attempts with backoff, response normalisation | `src/server/notifications/inforu.ts` (`post`) | Single client for SMS + email; log-only mode via `SIGN_LOG_NOTIFICATIONS` |
| SMS provider (single recipient) | `InforuSmsProvider` | Uses `SMS/SendSms` with `Settings.Sender = SIGN_SMS_SENDER` |
| Email provider (single recipient) | `InforuEmailProvider` | Uses `Umail/Message/Send` with `IncludeContacts`; now also `ReplyAddress`, `FromName`, `Attachments` |
| OTP | `src/server/signing/otp.ts`, `src/server/auth/login.ts` | Own codes, sent as SMS through the provider |
| Delivery rows + audit | `deliveries` table, `audit_events` (`sms_sent`, `email_sent`, `*_failed`) | `send-agreement.ts` |
| Readiness check | `src/app/api/ready/route.ts` | Reports whether Inforu is configured |
| Rate limiting (ours) | `src/server/http/rate-limit.ts` | Per-IP/user buckets for public doors |

A distribution adapter will add, on the same client: batched `SendSms` /
`Message/Send` with `CustomerMessageID`/`CampaignRefId` = our ids,
`CheckIfUnsubscribe` before sending, `PullData` and `GetMailNotification`
sync jobs, and `Campaign/Job` polling. No second client, no second set of
credentials.

## Things that need Inforu support before they work

1. Push DLR for SMS in JSON (otherwise we pull).
2. Storing email notifications so `GetMailNotification` returns data.
3. Unsubscribe push URL (optional; the pull list covers it).
4. `GetSentMessages` (sales) — not required for the plan.
5. White-listing: the SMS sender id(s) and the email `FromAddress` /
   `ReplyAddress` values the campaigns will use.
