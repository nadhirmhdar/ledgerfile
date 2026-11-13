-- Reviewer sign-off on individual audit procedures and checklist steps.
--
-- A procedure has at most one review at a time, and it belongs to that procedure's current work,
-- so it is recorded on the row itself. The application refuses to change reviewed work until the
-- review is withdrawn, and every review and withdrawal is written to the audit log, so the history
-- is kept there. Both columns are set together or not at all.
alter table audit_procedures
  add column reviewed_by uuid references users(id),
  add column reviewed_at timestamptz,
  add constraint audit_procedures_review_pair check ((reviewed_by is null) = (reviewed_at is null)),
  -- Only finished work can carry a review.
  add constraint audit_procedures_review_finished check (reviewed_by is null or status <> 'open');
