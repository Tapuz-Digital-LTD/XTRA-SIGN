# 0002 — A project's public address is not its identity

**Status:** accepted · **Date:** 2026-09-06

## Context

A campaign page lives at a public address people print on flyers, paste
into WhatsApp and put behind QR codes. Marketing wants to change that
address ("/tourism-2026" → "/israel-tourism-month-2026") without asking a
developer, and without any of the printed links dying. At the same time the
project's identity is referenced by registrations, agreements, signing
links, the register API and idempotency keys, and none of those may move
when the address does.

The campaign's pages themselves are code (the "skin"): the call-for-suppliers
page, the joining page, the thank-you page in the Ministry's own graphic
language. There is no page builder and there will not be one for this; a
developer binds a skin to a project in its configuration.

## Decision

- **Three identifiers, three jobs.** The project id (`groups.id`) is the
  identity. The form id (`groups.landing_slug`, a random opaque string minted
  once) is what the public register API is addressed by. The public address
  (`project_public_slugs.slug`) is what people see, and it is theirs to change.
- **Addresses accumulate; none is ever reused.** Changing the address inserts a
  new current row and retires the previous one with `replaced_at`. Every
  address the project ever had keeps answering with one `308` straight to the
  current one — never a chain — with the rest of the path and the whole query
  string (UTM included) carried along. Slugs are unique across the whole
  system, so a retired address can never be handed to another project; a
  project may take back one of its own.
- **Reserved paths.** The campaign routes are a root dynamic segment
  (`/[slug]`). Anything the application already answers at the root
  (`/api`, `/projects`, `/sign`, `/join`, …) is refused as an address, as is
  anything that is not lower-case ASCII letters, digits and hyphens.
- **The UI shows the campaign page, not a list of pages.** The settings show
  "עמוד הקמפיין" with its address and open / copy / change; there is no
  dropdown of branded pages, because there is nothing a person could create
  there. A project without a bound skin says so.

## Consequences

- Links we mint (SMS, email, the engine's hand-off to the campaign signer
  page) always look up the current address at send time; an agreement made
  under last month's address lands on this month's.
- The register API and everything downstream (registrations, agreements,
  idempotency) never see the address at all.
- Analytics of "which old link did they use" is not recorded on the
  redirect; the landing URL the browser reports after the redirect is the
  canonical one. If that ever matters, the redirect can append a marker —
  deliberately not done now to keep printed links clean.
- A second bespoke campaign means a second skin in code plus a project bound
  to it; the address machinery is shared.
