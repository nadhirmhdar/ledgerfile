-- A reference and a place on the working paper index for an uploaded file.
--
-- The index of working papers is derived from what the engagement already holds, so nothing here duplicates a paper. An uploaded file
-- is the one thing the application cannot place by itself, so the preparer may give it a reference and say where it is filed.
--
-- A file's reference has a shape the application's own references never take (a letter, one or two digits, "-F", then digits, such
-- as C5-F2). Test schedules are C5-1, procedures C5.P and so on, so a reference typed here can never collide with one made later.
-- It is unique within an engagement when it is set.
--
-- section_code names the area or checklist the file is filed under. Only a file that supports the engagement generally carries one:
-- a file that supports a lead sheet or a procedure is filed where that lead sheet or procedure is, so the two cannot disagree.
alter table working_papers
  add column reference text,
  add column section_code text,
  add constraint working_papers_reference_shape check (reference is null or reference ~ '^[A-E][0-9]{1,2}-F[1-9][0-9]{0,2}$'),
  add constraint working_papers_section_shape check (section_code is null or section_code ~ '^[A-E][0-9]{1,2}$'),
  add constraint working_papers_section_engagement_only check (section_code is null or target_kind = 'engagement'),
  -- Where both are given, the reference starts with the code of the place the file is filed.
  add constraint working_papers_reference_in_section check (reference is null or section_code is null or split_part(reference, '-', 1) = section_code);

create unique index working_papers_engagement_reference on working_papers (engagement_id, reference) where reference is not null;

-- Evidence stays immutable: only these two columns may be changed after upload.
grant update (reference, section_code) on working_papers to app_user;
