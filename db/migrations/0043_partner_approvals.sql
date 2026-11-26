-- Partner approval of acceptance and planning (owner decision B1, 2026-11-26): the engagement partner records "Acceptance approved" and "Planning
-- approved" on an engagement, and only the final lock requires them. The planning approval remembers the materiality revision and the risk ratings it
-- was given for, so that a later change makes it stale.
--
-- Six nullable columns on engagements and nothing else: no default and no backfill, which PostgreSQL adds as metadata only (no table rewrite, no
-- scan), so it is safe for db:setup-hosted on the live database, and the old code, which never reads them, is unaffected. No new table, so
-- purge_engagement() and retention_counts() are not touched: the columns are deleted with the engagement row itself.
--
-- planning_approved_materiality_id has NO foreign key on purpose: purge_engagement() deletes an engagement's materiality rows before the engagement row,
-- and a reference from that row to them would stop the deletion. The application only ever compares it with the engagement's latest materiality row.
alter table engagements add column acceptance_approved_by uuid references users(id);
alter table engagements add column acceptance_approved_at timestamptz;
alter table engagements add column planning_approved_by uuid references users(id);
alter table engagements add column planning_approved_at timestamptz;
alter table engagements add column planning_approved_materiality_id uuid;
-- A fingerprint of every risk rating at the time of approval (area, assertion, level).
alter table engagements add column planning_approved_risk_digest text;
