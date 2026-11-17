# Deploying LedgerFile on Vercel with Supabase

This note is for the owner. **No cloud resource has been created for it**: no Supabase project, no Vercel project, no keys. Everything
below is what to do, in order, when you create them. Every value in angle brackets is a placeholder.

## What runs where

| Part | Local development and tests | Hosted |
| --- | --- | --- |
| Database | PGlite, in `.data/pg` (or in memory for tests) | Supabase Postgres, through `DATABASE_URL` |
| Files | A folder, `.data/files` | A private Supabase Storage bucket, `FILE_STORE=supabase` |
| Sign-up | Open | Closed unless `SIGNUP_OPEN=1` |
| Demo users | `npm run seed` | Never. `npm run seed:sample-hosted` for an invented sample firm |

The app is "hosted" when **any** of `DATABASE_URL`, `LEDGERFILE_HOSTED=1` or `VERCEL` is set. Hosted with no `DATABASE_URL` refuses
to start rather than fall back to the local database, and hosted with no `FILE_STORE` refuses to store a file.

## Environment variables

See `.env.example` for each one with a comment. Set them in Vercel under Settings > Environment Variables (Production, and Preview if
you use previews).

| Variable | Needed | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Runtime connection: the Supabase **transaction pooler** (port 6543), as `ledgerfile_app` |
| `DATABASE_URL_MIGRATIONS` | for `db:migrate` and the sample seed | Direct or **session pooler** connection (port 5432), as the owner role (`postgres`). Not needed at runtime |
| `DATABASE_POOL_MAX` | no | Connections per server instance, default 3 |
| `LEDGERFILE_HOSTED` | no | `1` to force hosted mode off Vercel |
| `SIGNUP_OPEN` | no | `1` to let new firms register; unset means closed when hosted |
| `FILE_STORE` | yes | `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | yes | Server-only. No `NEXT_PUBLIC_` prefix, ever |
| `SAMPLE_ADMIN_PASSWORD`, `SAMPLE_PARTNER_PASSWORD`, `SAMPLE_REVIEWER_PASSWORD`, `SAMPLE_PREPARER_PASSWORD` | for the sample seed only | Four different passwords of 10 or more characters |

Use `?sslmode=require` on Supabase connection strings. Never paste a connection string or key into a chat, a commit or an issue.

## Order of work

1. **Create the Supabase project** and the **private bucket** (Storage > New bucket, "Public bucket" off). The app never makes a
   public or signed URL: every download goes through the app's logged route.
2. **Run the migrations** from your machine, as the owner role:
   `DATABASE_URL_MIGRATIONS=<direct or session-pooler URL> npm run db:migrate`. It applies `db/migrations` in order, in one
   transaction each, behind an advisory lock, and loads the standard groups. Running it again changes nothing. The deployed app
   never migrates; at start it checks that the database is at the migration the code expects and stops with a clear error if not.
   **Run `db:migrate` before every deploy that adds a migration.**
3. **Create the runtime role**, once: `psql "<owner URL>" -v app_password='<long random password>' -f docs/hosted-roles.sql`. The
   SQL is below. Then build `DATABASE_URL` from `ledgerfile_app` and its password, using the transaction pooler.
4. **Optionally seed the invented sample firm**: set the four `SAMPLE_*_PASSWORD` variables and run
   `npm run seed:sample-hosted`. It refuses a missing, short, repeated or public password. Its sign-ins are the invented
   `@ledgerfile.test` addresses.
5. **Create the Vercel project**, set the variables, deploy. Create the real administrators by turning sign-up on for a moment
   (`SIGNUP_OPEN=1`), registering, and turning it off again; or by seeding.

## The database role (why, and the SQL)

The app connects as **`ledgerfile_app`**, not as `postgres`. `postgres` owns every table, so row-level security does not apply to it,
and it can do far more than the app needs. `ledgerfile_app` owns nothing, is not a superuser, cannot bypass row-level security, and
has `NOINHERIT`, so it holds no table privilege itself. It can only, inside a transaction, switch to one of two roles:

- **`app_user`**: tenant work, through `withFirm`. Row-level security confines every statement to one firm.
- **`app_auth`**: sign-in, sessions, sign-up and user management. These happen before the firm is known, so they cannot use
  `withFirm`. Migration 0019 gives this role exactly: select and insert on `firms`; select, insert and update on `users`; select,
  insert and delete on `sessions`; insert only on `audit_log`; and a policy on each. It has no access to any tenant business table.

Neither role owns a table, is a superuser, or has `BYPASSRLS`. This is checked by the tests. The SQL is `docs/hosted-roles.sql`:

```sql
create role ledgerfile_app login password '<generated>' nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant app_user to ledgerfile_app with inherit false, set true;   -- Postgres 16+; earlier: grant app_user to ledgerfile_app;
grant app_auth to ledgerfile_app with inherit false, set true;
grant select on schema_migrations to ledgerfile_app;              -- the start-time version check
-- Supabase only: LedgerFile does not use the Data API, so close it to anon and authenticated.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
```

Also remove `public` from the exposed schemas in Supabase Settings > API.

## Connections

- Runtime uses the **transaction pooler** (6543). That is safe here because every per-request setting is transaction-local: `withFirm`
  and `withAuth` run `SET LOCAL ROLE` and `set_config(..., true)` inside one transaction on one connection, and nothing is set for
  the session. The driver sends unnamed statements only, so no prepared statement can be lost between pooled connections.
- Migrations need a **direct or session** connection (5432): they run several statements and take an advisory lock.

## Uploads

Vercel Functions limit a request or response body to about 4.5 MB. Hosted uploads are therefore capped at **4 MB** (locally 10 MB),
from one helper, `maxUploadBytes()` in `src/server/config.ts`, read by the browser check and the server check at every upload entry
point. A larger file gets the clear message "The file is larger than 4 MB." Uploading straight to storage with a signed URL, to lift
the cap, is a follow-up (it needs a server action to issue the URL and one to verify the object's size and sha256 afterwards).
Downloads are logged first and then served by the app; a file stored before the cap that is over 4.5 MB is refused with a clear
message rather than cut off.

## Not done

- No Supabase project, bucket, Vercel project, domain or key exists. Nothing was run against a real Supabase.
- Direct-to-storage uploads (above).
- Backups, monitoring and a password-reset email flow are not part of this change.
