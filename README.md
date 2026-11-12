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
- Statement of financial position and statement of comprehensive income with comparatives, drill-down to lead sheets, and checks that must pass before the statements are clean.
- Tenant isolation enforced in the database with row-level security, and an append-only audit log.

## Not built yet

Sign-in (every request runs as one seeded demo firm), the statement of changes in equity, cash flow statement,
notes, rounding and Word/PDF export, the audit engine, sign-off and review points, working paper files, journal listing import, and AI features.

## Run it

```bash
npm install
npm run sample   # writes synthetic trial balances to samples/
npm run seed     # optional: loads the sample client (run while the dev server is stopped)
npm run dev      # http://localhost:3000
```

```bash
npm test         # unit, database and tenant-isolation tests
npm run typecheck
npm run lint
```

## Layout

| Path | Purpose |
|---|---|
| `db/migrations/` | PostgreSQL schema and row-level security policies |
| `src/domain/` | Pure logic: money, trial balance parsing, mapping, lead sheets, journals, statements, grouping structure |
| `src/server/` | Database access, Excel reading, session |
| `src/app/` | Screens and server actions |
| `tests/` | Vitest suites |
| `scripts/` | Sample data generator and loader |
| `docs/` | Build plan and the draft audit methodology library (unreviewed AI drafts) |

## Notes

- Development uses PGlite, an embedded PostgreSQL, stored in `.data/` (not committed). The schema is plain PostgreSQL and is intended to run on a managed Postgres in production.
- Amounts are stored as integer minor units; debits positive, credits negative.
- All sample data is invented.
