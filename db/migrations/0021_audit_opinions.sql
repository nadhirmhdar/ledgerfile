-- The partner's decision on the audit opinion, one row per engagement: the kind of opinion, the basis for any modification, whether the
-- partner records a material uncertainty about going concern (and the note that discloses it), the optional emphasis-of-matter and
-- other-matter text, the date of the report, and who decided it and when. The auditor's report (the next slice) is worded from this row.
--
-- Additive only: one new table with its policy and grants. Nothing existing is altered, so it is safe to run on the live database while an
-- older build is still serving. app_auth gets nothing here. The checks repeat the rules the application applies, as a last line of defence:
-- a modified opinion has a basis, and a disclaimer carries no going-concern section or emphasis of matter.
create table audit_opinions (
  engagement_id uuid primary key,
  firm_id uuid not null references firms(id),
  opinion text not null check (opinion in ('unmodified', 'qualified', 'adverse', 'disclaimer')),
  basis_for_modification text check (basis_for_modification is null or char_length(basis_for_modification) <= 4000),
  -- The note that discloses a material uncertainty about going concern. Null means no such section in the report.
  going_concern_note text check (going_concern_note is null or char_length(going_concern_note) between 1 and 100),
  emphasis_of_matter text check (emphasis_of_matter is null or char_length(emphasis_of_matter) <= 4000),
  other_matter text check (other_matter is null or char_length(other_matter) <= 4000),
  report_date date,
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default clock_timestamp(),
  unique (firm_id, engagement_id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id),
  check (opinion = 'unmodified' or char_length(btrim(coalesce(basis_for_modification, ''))) > 0),
  check (opinion <> 'disclaimer' or (going_concern_note is null and emphasis_of_matter is null))
);

alter table audit_opinions enable row level security;
create policy tenant on audit_opinions using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update, delete on audit_opinions to app_user;
