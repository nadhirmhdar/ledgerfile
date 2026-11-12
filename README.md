# LedgerFile

A cloud working-paper and financial-statement tool for audit and accounting firms.
This repository holds the first slice of the MVP: trial balance to lead sheets.

## What works today

- Clients and engagements, with each engagement linked to the client's prior year.
- Trial balance import from Excel (.xlsx) or CSV, with Debit/Credit or single Balance columns and an optional Prior Year column. A file that does not balance is rejected.
- Account mapping to a standard grouping structure:
  - accounts mapped last year keep last year's group;
  - new accounts get a rule-based suggestion marked for review;
  - the preparer can change any mapping or accept all suggestions.
- Lead sheets per group with prior-year comparison, checked to agree with the trial balance.
- Adjusting and reclassification journal entries, with numbers that are never reused. Entries flow through to lead sheets and statements.
- A full set of financial statements with comparatives: financial position, comprehensive income, changes in equity, cash flows (derived, indirect method) and notes with a breakdown of each line. Borrowings can be split between current and non-current. Optional rounding to whole units, drill-down to lead sheets, checks that must pass before the statements are clean, and download as a Word document.
- Review and sign-off: preparer and reviewer sign-off per lead sheet (different people, except in a firm with a single user), review points that must be cleared, automatic removal of a sign-off when its figures change, and partner lock and unlock.
- Sign-in: firms register themselves, the first user is the administrator and adds colleagues with a role. Passwords are hashed with scrypt, accounts lock after repeated failures, and sessions expire after 12 hours.
- Tenant isolation enforced in the database with row-level security, and an append-only audit log.

## Not built yet

Password reset by email and email verification, PDF export, the audit engine, working paper files, journal listing import, and AI features.

## Run it

```bash
npm install
npm run sample   # writes synthetic trial balances to samples/
npm run seed     # optional: creates a demo firm and sample client (run while the dev server is stopped)
npm run dev      # http://localhost:3000
```

```bash
npm test         # unit, database and tenant-isolation tests
npm run typecheck
npm run lint
```

After `npm run seed`, sign in as `demo@ledgerfile.test`. The password is `DEMO_PASSWORD`, with a default in `.env.example`
that is for your own machine only. Or open `/sign-up` and register a new firm.

## Layout

| Path | Purpose |
|---|---|
| `db/migrations/` | PostgreSQL schema and row-level security policies |
| `src/domain/` | Pure logic: money, trial balance parsing, mapping, lead sheets, journals, statements, grouping structure |
| `src/server/` | Database access, authentication and sessions, Excel reading |
| `src/app/` | Screens and server actions |
| `tests/` | Vitest suites |
| `scripts/` | Sample data generator and loader |
| `docs/` | Build plan and the draft audit methodology library (unreviewed AI drafts) |

## Notes

- Development uses PGlite, an embedded PostgreSQL, stored in `.data/` (not committed). The schema is plain PostgreSQL and is intended to run on a managed Postgres in production.
- Amounts are stored as integer minor units; debits positive, credits negative.
- All sample data is invented.
- Authentication code runs as the database owner because sign-in happens before the firm is known; all other access goes through the tenant role. The tenant role cannot read password hashes or sessions.
- Known gaps before any public deployment: no rate limiting by IP address, open self-registration, no password reset, and account lockout can be triggered by anyone who knows an email address.
