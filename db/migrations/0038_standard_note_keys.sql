-- Standard notes beyond the policies: five new passage keys (related, tax, commitments, events, going_concern).
--
-- Only widens the note_key checks on note_texts (0032) and firm_note_defaults (0035) so the new keys are accepted: each constraint is dropped and added
-- again with the new keys as well as every old one. Re-adding validates the existing rows, which already match the narrower pattern; the tables are small.
-- Nothing else changes, no row is touched, and an older build serving the same database simply never writes the new keys. Safe for live Neon.

alter table note_texts drop constraint note_texts_note_key_check;
alter table note_texts add constraint note_texts_note_key_check
  check (note_key ~ '^(general|basis|policies|related|tax|commitments|events|going_concern|policy:[a-z0-9-]{1,80}|group:[A-Z0-9_]{1,40})$');

alter table firm_note_defaults drop constraint firm_note_defaults_note_key_check;
alter table firm_note_defaults add constraint firm_note_defaults_note_key_check
  check (note_key ~ '^(general|basis|policies|related|tax|commitments|events|going_concern|policy:[a-z0-9-]{1,80})$');
