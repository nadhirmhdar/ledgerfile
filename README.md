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
- Audit (first slice): a materiality calculator with revision history, risk assessment by area and assertion, and audit programmes loaded from the methodology library according to the risks assessed. Checklists for acceptance, planning, completion and reporting load when the audit is turned on, and a summary of misstatements is compared with materiality. Each procedure records work done and a conclusion, and unfinished audit work holds up the lock. **The methodology content is an unreviewed AI draft** and says so on screen.
- Journal entry testing: import the client's journal listing (up to 50,000 lines), check it is complete against the trial balance, flag entries with risk characteristics (period end, weekends, round amounts, no description, unusual revenue pairings, seldom-used or unknown accounts), then select entries and record the work and conclusion on each.
- Working papers: upload evidence files (up to 10 MB, common document types) against the engagement, a lead sheet or an audit procedure; download and removal are permission-checked and logged, and a file changed on disk is refused. A sample-size calculator sits on each fieldwork programme.
- Review and sign-off: preparer and reviewer sign-off per lead sheet (different people, except in a firm that has only ever had one user), review points that must be cleared, automatic removal of a sign-off when its figures change, and partner lock and unlock.
- Role restrictions: only a partner-level user adds clients, only a reviewer or above opens engagements, and a journal can be deleted by its author or a reviewer. Everyone can do the day-to-day engagement work.
- Sign-in: firms register themselves, the first user is the administrator and adds colleagues with a role. Passwords are hashed with scrypt, accounts lock after repeated failures, and sessions expire after 12 hours. Users change their own password; an administrator can reset a colleague's password, change roles, and deactivate or reactivate users.
- Tenant isolation enforced in the database with row-level security, and an append-only audit log.

## Not built yet

Password reset by email and email verification, PDF export, the rest of the audit engine (modified opinions, auditor's report), and AI features.

## Run it

```bash
npm install
npm run sample   # writes synthetic trial balances and a journal listing to samples/
npm run seed     # optional: creates a demo firm and sample client (run while the dev server is stopped)
npm run dev      # http://localhost:3000
```

```bash
npm test         # unit, database and tenant-isolation tests
npm run typecheck
npm run lint
```

After `npm run seed`, four demo users exist in one firm, one per role: `demo@ledgerfile.test` (administrator), `partner@ledgerfile.test`,
`reviewer@ledgerfile.test` and `preparer@ledgerfile.test`. They share one password, `DEMO_PASSWORD`, with a default in `.env.example`
that is for your own machine only. Or open `/sign-up` and register a new firm.

## Layout

| Path | Purpose |
|---|---|
| `db/migrations/` | PostgreSQL schema and row-level security policies |
| `src/domain/` | Pure logic: money, trial balance parsing, mapping, lead sheets, journals, statements, grouping structure |
| `src/server/` | Database access, authentication and sessions, Excel reading |
| `src/app/` | Screens and server actions |
| `tests/` | Vitest suites |
| `scripts/` | Sample data generator and loader; `npm run methodology` rebuilds the procedure library from `docs/` |
| `docs/` | Build plan and the draft audit methodology library (unreviewed AI drafts) |

## Notes

- Development uses PGlite, an embedded PostgreSQL, stored in `.data/` (not committed). Uploaded working papers are kept in `.data/files/`; production would use object storage. The schema is plain PostgreSQL and is intended to run on a managed Postgres in production.
- Amounts are stored as integer minor units; debits positive, credits negative.
- All sample data is invented.
- Authentication code runs as the database owner because sign-in happens before the firm is known; all other access goes through the tenant role. The tenant role cannot read password hashes or sessions.
- Known gaps before any public deployment: no rate limiting by IP address, open self-registration, no password reset by email (an administrator who forgets their password has no way back in unless another administrator resets it), and account lockout can be triggered by anyone who knows an email address.
