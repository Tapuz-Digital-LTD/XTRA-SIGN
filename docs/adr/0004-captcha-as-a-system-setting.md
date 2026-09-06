# 0004 — CAPTCHA is a system setting behind a provider interface

**Status:** accepted · **Date:** 2026-09-06

## Context

Login sends an SMS, and the public forms create records, on nothing but a
browser request. Rate limits and honeypots hold the line against the
simplest abuse; a score-based CAPTCHA adds the next layer. The owner wants
to switch it on and off, and to replace the Google Cloud project or keys
next year, from the product — no code change, no deployment.

## Decision

- **One service, one question.** `verifyCaptcha({ action, token })` is the
  only thing a route asks, before an OTP goes out or a registration is
  written. The answer is pass, or one human sentence. Providers implement a
  small interface (`verify`, `test`); today there is one, Google reCAPTCHA
  Enterprise, built strictly on the documented assessment API: a token is
  single-use and expires after two minutes, so the browser mints it at
  submit time; the assessment's `action` must equal the expected action
  (`LOGIN_OTP`, `PUBLIC_FORM_SUBMIT`, `CAMPAIGN_REGISTRATION`) and the score
  must clear the threshold. Tokens are never stored.
- **Settings live in `system_settings`**, one row for the whole system,
  replaced atomically. The API credential is encrypted at rest (AES-256-GCM
  under `SIGN_SECRETS_KEY`, set once per deployment) and is shown afterwards
  only as its last characters; the site key is public by nature. Every
  change is an `admin_audit_events` row naming the fields that changed, never
  the secret. A "בדיקת חיבור" runs a real assessment call with a throwaway
  token to prove the project, key and credential before "שמור והפעל".
- **Fail secure.** With CAPTCHA on, a provider outage or a broken
  configuration refuses the protected request and notifies the admins (at
  most once per ten minutes). Off means off: no script, no token, no
  assessment — the other protections remain. Rate limiting is not replaced.
- **Only browser doors.** The authenticated submission API and every
  server-to-server integration are untouched; an embedded form runs our own
  page inside the iframe, so the same protection and the same Google domain
  allow-list (managed in Google Cloud, not here) apply.
- **Environments stay apart** because Preview and Production have separate
  databases: each carries its own `system_settings` row and its own keys.

## Consequences

- A second provider is a second class implementing the interface and a
  second option in the settings' provider list; the doors do not change.
- The threshold is the admin's ("רמת הגנה" with an advanced number); Google's
  advice to tune it after 48 hours of real traffic is shown, not assumed.
