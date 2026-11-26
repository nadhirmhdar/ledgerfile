-- Optional engagement quality review (owner decision B2, 2026-11-26): off by default; when on, the file cannot be locked until the named EQ reviewer
-- signs.
--
-- Five columns on engagements and nothing else. eq_review_required is "not null default false", which PostgreSQL adds as metadata only (no table
-- rewrite, no scan); the rest are nullable with no default. No backfill: every existing engagement is off, and the old code, which never reads these
-- columns, is unaffected. No new table, so purge_engagement() and retention_counts() are not touched: the columns go with the engagement row.
alter table engagements add column eq_review_required boolean not null default false;
alter table engagements add column eq_reviewer_id uuid references users(id);
alter table engagements add column eq_signed_by uuid references users(id);
alter table engagements add column eq_signed_at timestamptz;
alter table engagements add column eq_note text check (length(eq_note) <= 2000);
