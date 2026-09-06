# 0003 — One deletion policy: archive and delete are two different things

**Status:** accepted · **Date:** 2026-09-06

## Context

The product had almost no way to remove a supplier, customer, project,
template or agreement, so real data and test data piled up together. At the
same time a signed agreement, its PDF and its audit trail are the legal
record — a tidy-up must never cost one of those. Each screen had started to
grow its own confirm dialog and its own idea of what "delete" means.

## Decision

- **One service decides.** `getDeletionImpact(type, id)` reports what stands
  behind a record (signed, open and draft agreements; memberships; leads;
  CRM link) and recommends an action; `deleteEntity(type, id, mode)` performs
  only what the policy allows. Every screen — row menus, detail pages,
  settings — uses the same `DeleteDialog` on top of it. There is no cascade
  delete anywhere.
- **Three situations, three answers.**
  1. Nothing behind it → deleted for real (hard delete where no row references
     it; otherwise soft), after one plain question.
  2. Unsigned work behind it (drafts, sent, viewed) → the drafts are deleted,
     the sent ones cancelled, then the record leaves the lists — after a
     dialog that says exactly that.
  3. Signed history behind it → **never deleted through the product.** The
     user may archive it (out of the active lists, everything kept) or ask an
     admin; an admin may perform a *protected removal* after acknowledging
     that the signed files and audit stay. The wording: "לרשומה זו קיימת
     היסטוריה חתומה ולכן לא ניתן למחוק אותה באופן רגיל…".
- **Archive ≠ delete.** Companies and agreements gain `archived_at`;
  agreements and companies gain `deleted_at` for protected removal; groups
  already had both. Listings hide archived and removed rows; nothing else
  changes. Signed PDFs, signature images and `audit_events` are never touched
  by any of these paths (the only pre-existing hard delete, of a *draft*, is
  kept as it was).
- **Never the CRM.** A company mirrored from Fireberry is archived or removed
  in XTRA Sign only; the provider interface has no delete verb and will not
  get one from here.
- **Audit.** Every removal, archive, restore and protected removal is an
  `admin_audit_events` row (who, when, what, which kind, the counts); a
  protected removal of an agreement also writes `archived` / `removed` to the
  agreement's own trail. A non-admin's "בקשת מחיקת מנהל" is a notification
  to the admins plus an audit row.
- **Converted registrations stay.** A lead that became a supplier or an
  agreement carries attribution and the idempotency key; it is history and
  cannot be deleted. Unconverted leads and notifications are plainly deletable.

## Consequences

- Bulk delete later is the same service over a list: the dialog already
  knows how to say "14 ניתנים למחיקה, 4 יועברו לארכיון, 2 דורשים אישור מנהל".
- Physical erasure (privacy requests) is a separate, deliberate flow — not
  reachable from any delete button.
- A soft-deleted CRM company still holds its `companies_crm_unique` slot;
  restoring or re-syncing it is an explicit admin action, not automatic.
