# XTRA Sign

Send a document, get it signed, keep the signed copy. Hebrew, RTL, mobile-first
for whoever receives the link.

One Next.js project on Vercel. No Docker, no servers, no infrastructure to run.

## Run it locally

```bash
npm install
npm run dev
```

That is the whole setup. With no `DATABASE_URL` you still need a Postgres — see
below — but with no `BLOB_READ_WRITE_TOKEN` documents are written to
`.data/blob/` and uploads go through a local stand-in route, so nothing has to
be provisioned to click around.

Point `DATABASE_URL` at any Postgres (a Neon branch is the easiest), then:

```bash
npm run db:migrate
npx tsx --env-file=.env.local scripts/bootstrap-admin.ts you@xtra.co.il 05X-XXX-XXXX "Your Name"
```

Copy `.env.example` to `.env.local` and fill in what you need. Everything is
optional except `DATABASE_URL`; unset notification credentials mean messages are
logged and reported as **not sent**, never as sent.

## Tests

```bash
npm test        # 137 tests. PGlite — a real Postgres in WASM. No Docker, no setup.
npm run lint
npm run build
```

`npm test` runs against PGlite and an in-memory document store. That covers the
SQL, the constraints, the migrations and every use-case — but it is not the real
database and not the real object store, so two suites are opt-in:

```bash
npm run test:live
```

It runs only what it has credentials for, and says loudly when it skips:

- `NEON_TEST_DATABASE_URL` — interactive transactions, rollback mid-statement,
  rollback on a thrown error, two writers racing a unique index, concurrent
  rate-limit increments, migrations against the real instance.
- `BLOB_READ_WRITE_TOKEN` — that a private object is refused without auth, that
  a presigned URL works and then expires, and that a file failing byte
  validation is actually deleted.

**Run it before the first deploy.** A green `npm test` does not prove either.

## Deploy

1. New Vercel project from this repo.
2. Add **Neon** and a **Blob store** from the Marketplace — `DATABASE_URL` and
   `BLOB_READ_WRITE_TOKEN` are injected automatically.
3. Set the rest of the environment variables from `.env.example`. In particular
   `SIGN_LOG_NOTIFICATIONS=false`, or nothing is actually sent.
4. Point `DATABASE_URL` at the new database locally and run `npm run db:migrate`
   once. Migrations are deliberately **not** part of the build: a build runs on
   every push and every preview, and a branch opened for an experiment must not
   be able to alter the live schema.
5. `npm run test:live`.
6. Seed the first admin. Everyone after that arrives by invitation.

## What it does not do

- **PDF only.** A Word file is refused at the upload with a message saying to
  save it as PDF. Converting DOC/DOCX needed LibreOffice in a container, and
  that container is not worth an entire deployment model.
- **WhatsApp is a share, not a send.** The button opens WhatsApp with a
  prefilled message; the user picks the contact and presses send there. Nothing
  here can observe delivery, so nothing claims it.
- No template library, no bulk send, no approval chains, no conditional logic.
