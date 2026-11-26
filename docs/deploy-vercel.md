# Deploying LedgerFile on Vercel (Neon and Blob)

This is the main hosting guide: **Vercel** for the app, **Neon** (added from the Vercel Marketplace) for Postgres, **Vercel Blob** for files. The older Supabase route is kept as an alternative in [deploy-vercel-supabase.md](deploy-vercel-supabase.md).

**No cloud resource has been created for this.** No Vercel project, Neon database, Blob store or token exists because of this change; the steps below are what to do when you create them. Every value in angle brackets is a placeholder. Nothing here was run against Neon, Blob or Vercel themselves; see "What was and was not verified" at the end.

## The one rule: the app never connects as the database owner

The Neon integration injects `DATABASE_URL` holding the **owner's** credentials. LedgerFile does not use it at runtime. The runtime connection is built in `src/server/config.ts` from Neon's pooled host and database name plus the `ledgerfile_app` login role and the password you enter as `LEDGERFILE_APP_PASSWORD`. `ledgerfile_app` owns nothing, is not a superuser, cannot bypass row-level security and holds no table privilege itself: it can only switch, inside a transaction, to `app_user` (tenant work) or `app_auth` (sign-in and sessions). If `LEDGERFILE_APP_PASSWORD` is missing the app refuses to start; it never falls back to the owner's URL. **Never point the runtime at the owner URL, and never set `DATABASE_URL` to it by hand.**

## Order of work

1. **Create the Vercel project** from this repository.
2. **Add Neon from the Vercel Marketplace** (Storage tab, then Neon). Choose the Neon region next to the Vercel function region (see Regions). The integration injects the database variables below.
3. **Add a Blob store, private** (Storage tab, then Blob, access **Private**). Connect it to the project so Vercel sets the Blob credentials. Set `FILE_STORE=vercel-blob`.
4. **Enter the five secrets** in Settings, Environment Variables: `LEDGERFILE_APP_PASSWORD` and the four `SAMPLE_*_PASSWORD` values (the four are only for a demo; skip them for a real firm). Generate each as a long random string (24 or more characters for the app password, 10 or more for the others, all different). Never reuse the demo password.
5. **Prepare the database once**: run `vercel env pull .env.vercel --environment=production` (the file is git-ignored by `.env*`; the `--environment` flag is from memory of the Vercel CLI, so check `vercel env pull --help`) and then `npm run db:setup-hosted`. The file is deliberately NOT `.env.local`, which Next.js reads for every local `npm run dev`, and it holds the database owner's password: **delete `.env.vercel` as soon as setup finishes**, and pull it again only when a later migration needs it. `db:setup-hosted`, `db:migrate` and `seed:sample-hosted` read `.env.vercel` if it exists, and work just as well when the variables come from CI or Vercel's own environment. As a second guard, a development server (`npm run dev`) refuses to start when the database it would use is not on this machine, unless `LEDGERFILE_ALLOW_REMOTE_DEV=1`. It needs no psql. It (a) runs the migrations over the direct owner connection, (b) creates or updates `ledgerfile_app` with the password from `LEDGERFILE_APP_PASSWORD`, sent to Postgres as a SCRAM-SHA-256 verifier where the server accepts one (plain Postgres, Supabase). **Neon does not**: its docs say "Hashed passwords are not supported" for SQL-set passwords (https://neon.com/docs/manage/roles, read 2026-11-17), and it refuses a verifier with "only supports being given plaintext passwords". On exactly that refusal setup sends the same statement again with the plaintext as an escaped literal, so on Neon the password is in the statement text and Neon's own logs may hold it. Neon also requires at least 60 bits of entropy for a password set through SQL, so use a long random string. **Shape of `LEDGERFILE_APP_PASSWORD` that Neon accepts** (https://neon.com/docs/manage/roles and https://neon.com/docs/manage/database-access, read 2026-11-17): at least 12 characters (setup requires 24) with a lowercase letter, an uppercase letter, a number AND a symbol, no character three times in a row, no sequences or dictionary words. A password of only letters and digits is refused. Setup checks this before it connects and says which part is missing, never the value. A password manager's 32-character setting with symbols turned on is a safe choice, and (c) seeds the invented sample firm if all four `SAMPLE_*_PASSWORD` values are set (otherwise it says it skipped). Every step can be repeated. It prints step names only, never a password, URL or token. **Run it again before any deploy that adds a migration** (the app checks at start that the database matches and refuses to run if it does not; it never migrates by itself).
6. **Deploy.** Sign-up is closed by default when hosted; open it briefly with `SIGNUP_OPEN=1` to register the first real administrator, then remove it.

## Variables

| Variable | Set by | Used | Secret | Purpose |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Neon integration | not used at runtime | yes (owner) | Pooled string with the **owner's** credentials. Its presence marks the deployment as hosted. Never the runtime connection |
| `DATABASE_URL_UNPOOLED` | Neon integration | setup | yes (owner) | Direct owner connection for migrations and setup |
| `PGHOST` | Neon integration | runtime | no | **Pooled** host, used to build the runtime URL |
| `PGHOST_UNPOOLED` | Neon integration | not used | no | Direct host |
| `PGDATABASE` | Neon integration | runtime | no | Database name, used to build the runtime URL |
| `PGUSER`, `PGPASSWORD` | Neon integration | not used for the app | yes (owner) | The owner. Used only to refuse a runtime connection as the owner |
| `POSTGRES_*` | Neon integration | not used | yes | Legacy names; ignored |
| `LEDGERFILE_APP_PASSWORD` | **you** | runtime and setup | **yes** | Password of `ledgerfile_app`, 24+ characters |
| `SAMPLE_ADMIN_PASSWORD`, `SAMPLE_PARTNER_PASSWORD`, `SAMPLE_REVIEWER_PASSWORD`, `SAMPLE_PREPARER_PASSWORD` | **you** | setup | **yes** | Passwords of the invented sample firm's four users (optional) |
| `FILE_STORE` | you (not secret) | runtime | no | `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` and OIDC | Blob connection | runtime | yes | Server-only credentials the Blob SDK reads. Never `NEXT_PUBLIC_`. Uploads over 4 MB need the token |
| `VERCEL` | Vercel | runtime | no | Marks the deployment as hosted |
| `SIGNUP_OPEN` | you (not secret) | runtime | no | `1` opens firm sign-up; unset means closed when hosted |
| `LEDGERFILE_DATABASE_URL` | you (optional) | runtime | yes | An explicit runtime URL that overrides the Neon parts (for another host). Refused if its user is a known owner |
| `DATABASE_URL_MIGRATIONS` | you (optional) | setup | yes | Overrides the direct connection for setup |
| `DATABASE_POOL_MAX` | you (optional) | runtime | no | Connections per server instance, default 3 |

### Runtime connection precedence

| Order | Source | Notes |
| --- | --- | --- |
| 1 | `LEDGERFILE_DATABASE_URL` | Explicit. Must not be the owner's user |
| 2 | `PGHOST` + `PGDATABASE` + `LEDGERFILE_APP_PASSWORD` | Built as `ledgerfile_app` with `sslmode=verify-full`; the password is URL-encoded; missing password refuses to start |
| 3 | `DATABASE_URL` set by hand | The Supabase setup. Refused if its user is the owner (`PGUSER`, or the user of `DATABASE_URL_UNPOOLED` or `DATABASE_URL_MIGRATIONS`) |
| none | | Hosted: refuses to start. Local: PGlite |

TLS is verified for every host except one on this machine (`localhost`, `127.0.0.1`, `::1`), which is only the CI service container. There is no variable that turns TLS off for another host. The code never sets `rejectUnauthorized: false`.

## Files: Vercel Blob, private

From the Vercel Blob docs ([private storage](https://vercel.com/docs/vercel-blob/private-storage), read 2026-11-17): private stores exist and are available on all plans (generally available since 2026-06-30 per the [changelog](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)); a private blob's URL "is not publicly accessible" and every read needs authentication. LedgerFile reads a blob on the server with `get(pathname, { access: "private" })` and serves it through its own logged download route, so no blob URL or token reaches the browser. Blobs are stored at exactly the server-generated key (no random suffix) and are never overwritten.

## Uploads and downloads

Vercel Functions limit a request body to 4.5 MB ([limitations](https://vercel.com/docs/functions/limitations)), so an upload that passes through a function stays capped at **4 MB** (`maxUploadBytes()`). Without `BLOB_READ_WRITE_TOKEN` that is the limit for every upload and the pages say so.

**Spreadsheet imports up to 25 MB** (trial balance, journal listing, schedule listing) go straight to the private Blob store when `FILE_STORE=vercel-blob` **and `BLOB_READ_WRITE_TOKEN` is set**, once the file is over 4 MB. The server records the key in `pending_uploads` with what it is for (migration 0045) and on which engagement; the browser sends the file with a token for that key only; the import action then takes the row, reads the object, runs the same parser and import as an ordinary upload, and **deletes the object**. An import upload never becomes a working paper and a working paper upload is never read as an import. Unfinished ones expire after 15 minutes and are swept like working-paper uploads. A trial balance preview sends the file again at each step, since the file is deleted after it is read. The client list import keeps the small limit (it is capped at 1,000 names).

Rows are limited too, and refused before the file is parsed: 20,000 for a trial balance, 100,000 for a journal or schedule listing (the journal parser itself takes at most 50,000 lines, a schedule 2,000). The reason is memory: the Excel reader holds the whole workbook, measured locally at about 700 MB for 100,000 rows and over 1 GB for 200,000, so a 25 MB workbook of rows would not fit a 2 GB function. A 25 MB CSV (234,000 lines) parsed in about 1.7 seconds using 690 MB. The limits are in `src/server/config.ts` (`IMPORT_DIRECT_BYTES`, `IMPORT_DIRECT_ROWS`).

**Working papers up to 50 MB** go straight from the browser to the private Blob store when `FILE_STORE=vercel-blob` **and `BLOB_READ_WRITE_TOKEN` is set** (the SDK signs client tokens with the read-write token; the store id with OIDC alone cannot, so that setup keeps the 4 MB form). The flow is begin (the server checks the user and the file's declared name and size and records a key in `pending_uploads`), token (`/api/blob-upload` issues a token for that key only, limited to the declared size, no overwrite, no random suffix, valid for 15 minutes), then finish (the server reads the object, checks its size against the declaration, hashes it itself and only then creates the working paper). A file that does not match is deleted and refused. An upload that is never finished expires after 15 minutes and is swept, with its blob, by the next upload in that firm. The limit is one constant, `DIRECT_UPLOAD_BYTES` in `src/server/config.ts`.

Downloads still go through the logged route and are streamed, so a 50 MB file is not subject to the 4.5 MB response cap (the docs say the cap "doesn't apply to" streamed responses; that is not confirmed for a Next.js route handler until it is tried on a deployment). The route reads the whole file and checks its sha256 before it sends the first byte, so a file that has changed is still refused (409).

**The whole-file download** (partners and administrators, Index page) is a zip streamed from one function. Its route sets `maxDuration = 300`: with fluid compute (on by default) 300 seconds is both the default and the maximum on Hobby, and within Pro and Enterprise ([limits](https://vercel.com/docs/functions/limitations), page last updated 2026-08-24, read 2026-11-26), and the limit covers the time spent sending the streamed response. The page shows "About N files, X MB" from stored sizes. A whole file estimated above `EXPORT_MAX_BYTES` (default 1 GB) is refused before it starts, and the file is then taken by index section. **A cut-off download can be told from a complete one:** `README.txt` is written last and its last line is `End of file: N entries`, the number of files in the zip. A zip without it, or whose count differs, is incomplete. A very slow connection can run past 300 seconds well under the cap: 1 GB needs about 3.5 MB a second sustained.

## Regions

Put the Vercel function region next to the Neon region ([function regions](https://vercel.com/docs/functions/configuring-functions/region), `vercel.json` `"regions"`; Hobby allows one region). Pairs both offer, per Vercel's and Neon's region pages (read 2026-11-17): Neon `aws-us-east-1` with `iad1`; `aws-us-east-2` with `cle1`; `aws-us-west-2` with `pdx1`; `aws-eu-central-1` (Frankfurt) with `fra1`; `aws-eu-west-2` (London) with `lhr1`; `aws-ap-southeast-1` with `sin1`; `aws-ap-southeast-2` with `syd1`; `aws-sa-east-1` with `gru1`. **Neither Vercel nor Neon lists a Gulf or Middle East region**, so for UAE users the nearest choice is Frankfurt, or Mumbai for Vercel only (Neon has no Mumbai region in its docs).

## Plan

Vercel's Hobby plan is "for your personal or non-commercial use" ([terms, section 4](https://vercel.com/legal/terms), last updated 2026-10-19). A firm using LedgerFile for client work needs the Pro plan.

## What was and was not verified

- **In CI, against real PostgreSQL 17** (a throwaway service container; the owner role is not a superuser but can create roles and databases, as Neon's is): `npm run db:setup-hosted` runs twice; `ledgerfile_app` logs in with the plaintext password after being created from a SCRAM verifier; the runtime URL is built from Neon-style variable names; the runtime test signs up, signs in, looks up a session, adds a user and checks two-firm isolation as `ledgerfile_app`; every database-backed test file runs through the adapter.
- **Not verified**: Neon itself (its pooler, SSL certificate, role creation under `neon_superuser`), Vercel Blob (the adapter is tested with a mocked SDK), and Vercel. Neon's docs say its PgBouncer is in transaction mode and recommend `SET LOCAL` inside a transaction; they do not mention `set_config(..., true)` or `SET ROLE`, which behave like `SET LOCAL` in a transaction. They do not say whether the injected connection strings include `sslmode`, or which role they hold (they are described as the project's owner role).
