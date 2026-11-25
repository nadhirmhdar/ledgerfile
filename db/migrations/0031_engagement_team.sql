-- Engagement team: who SHOULD do the work on an engagement, and when the report is due.
--
-- Until now the file recorded only who DID something (sign-offs, performed_by, prepared_by, reviewed_by). These four columns record who is
-- assigned as preparer, reviewer and partner, and the date the report is due, so each person can see what waits for them without opening
-- every engagement.
--
-- Additive and safe for db:setup-hosted on the live database: four nullable columns with no default and no backfill, which PostgreSQL adds as
-- metadata only (no table rewrite, no scan). Every existing engagement keeps all four empty ("Not assigned", "No date"), and the old code, which
-- never reads them, is unaffected. No index: a firm has tens of engagements, and an index build would take a lock for no gain.
--
-- The archive guard (0022) does not list these columns, so the application refuses changes on a locked or archived engagement itself, with
-- its existing locked-file wording. The server also checks that each person is an active user of the same firm; the foreign key to users
-- is the last line of defence below that.
alter table engagements add column preparer_id uuid references users(id);
alter table engagements add column reviewer_id uuid references users(id);
alter table engagements add column partner_id uuid references users(id);
alter table engagements add column report_due_on date;
