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
npm test        # 174 tests. PGlite — a real Postgres in WASM. No Docker, no setup.
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
3. Set the rest of the environment variables from `.env.example`. In particular:
   - `SIGN_PUBLIC_URL` — the exact origin people open the app at, scheme and
     host (`https://xtra-sign.vercel.app`). Every login, upload and send is
     refused with "הבקשה נדחתה." unless the browser's Origin matches it.
     `/api/ready` reports a bad value as `origin: false`. A custom domain goes
     in `SIGN_EXTRA_ORIGINS`.
   - `SIGN_LOG_NOTIFICATIONS=false`, or nothing is actually sent.

   Environment changes only reach a deployment on its next build, so redeploy
   after editing them.
4. Point `DATABASE_URL` at the new database locally and run `npm run db:migrate`
   once. Migrations are deliberately **not** part of the build: a build runs on
   every push and every preview, and a branch opened for an experiment must not
   be able to alter the live schema.
5. `npm run test:live`.
6. Seed the first admin. Everyone after that arrives by invitation.

## Three ways a document starts

- **Upload a PDF.** The browser PUTs the file straight to Blob on a presigned
  URL; the server then reads the bytes back and validates them.
- **Write it in the system.** A title and plain text — `#` for a heading, `-`
  for a list item, `---` for a page break — rendered to an A4 PDF with the same
  embedded Hebrew font the signed copy uses. From there it is an ordinary
  document: fields, recipient, send, sign.
- **From a template.** Any document with its fields laid out can be saved as a
  template from its page. A new document from a template gets its own copy of
  the PDF and the fields already in place. Templates are shared within the
  organization; the person who made one, or an admin, can rename or delete it.

## What it does not do

- **PDF only.** A Word file is refused at the upload with a message saying to
  save it as PDF. Converting DOC/DOCX needed LibreOffice in a container, and
  that container is not worth an entire deployment model.
- **WhatsApp is a share, not a send.** The button opens WhatsApp with a
  prefilled message; the user picks the contact and presses send there. Nothing
  here can observe delivery, so nothing claims it.
- No bulk send, no approval chains, no conditional logic.
