-- Working paper versions: a new upload can replace a file and keep the earlier one.
--
-- One nullable column and constraints, no backfill and no data touched: every existing paper has no replaces_id, so it is version 1 and current, exactly as
-- before. Safe for db:setup-hosted on the live database while an older build is serving (the old code never reads the column).
--
--   working_papers.replaces_id   the version this row replaces. A paper's CURRENT version is the row no other row replaces; versions are counted along
--                                the chain (version 1 is the row with no replaces_id). The reference and section move to the current version in the
--                                application, in the same transaction as the upload; the earlier version keeps neither.
--   pending_uploads.replaces_id  the same, carried through a direct (hosted) upload until it is finished. No foreign key: it is only a note, and the
--                                finish step checks it again inside its own transaction.
--
-- The self-reference is the default NO ACTION, which is checked at the end of the statement, so purge_engagement()'s one delete of all the engagement's
-- working_papers rows (both versions at once) is valid and needs no change. Its list of file-store keys is read from the same table, so it includes every version.

alter table working_papers add constraint working_papers_scope_id unique (firm_id, engagement_id, id);
alter table working_papers add column replaces_id uuid;
alter table working_papers add constraint working_papers_replaces
  foreign key (firm_id, engagement_id, replaces_id) references working_papers (firm_id, engagement_id, id);
alter table working_papers add constraint working_papers_not_self check (replaces_id is null or replaces_id <> id);
-- One replacement per paper: two uploads cannot both become "the next version" of the same one.
create unique index working_papers_one_replacement on working_papers (replaces_id) where replaces_id is not null;

alter table pending_uploads add column replaces_id uuid;
