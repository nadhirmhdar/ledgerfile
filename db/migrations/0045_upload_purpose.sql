-- What a pending direct upload is FOR. A null purpose is a working paper (every row that existed before this, and every working paper upload since);
-- the others are spreadsheet imports, which are read on the server and then deleted and never become working papers.
--
-- One nullable column on pending_uploads with a check and no default or backfill, which PostgreSQL adds as metadata only (the check is validated against
-- existing rows, all null). No new table, so purge_engagement() and retention_counts() are not touched. Safe for db:setup-hosted on the live database
-- while an older build is serving: the old code never writes the column, and only the new code creates import rows.
alter table pending_uploads add column purpose text check (purpose is null or purpose in ('trial_balance', 'journal_listing', 'schedule_listing'));
