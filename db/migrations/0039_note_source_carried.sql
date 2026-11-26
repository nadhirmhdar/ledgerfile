-- Roll-forward carries last year's person-edited notes (owner decision 2026-11-25). A carried passage is stored as version 1 of the new engagement with
-- source 'carried_forward'.
--
-- Only widens the note_texts.source check added in 0035 so it also accepts 'carried_forward': the constraint is dropped and added again with the new
-- value as well as the old ones. Existing rows are null, 'person' or 'firm_default', so they already pass. No new table and no function changes
-- (purge_engagement and retention_counts are untouched), no row is touched, and an older build serving the same database simply never writes the new
-- value. Safe for live Neon.

alter table note_texts drop constraint note_texts_source_check;
alter table note_texts add constraint note_texts_source_check
  check (source is null or source in ('person', 'firm_default', 'carried_forward'));
