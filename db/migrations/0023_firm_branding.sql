-- Firm branding: an address, a contact line and a registration line, and a logo, shown on the letters, statements and auditor's report the firm
-- downloads.
--
-- Additive only: eight NULLABLE columns on firms, no default, no backfill, so every existing firm has no branding and every output looks exactly
-- as it did. Adding nullable columns is a metadata-only change on PostgreSQL, so it is safe to run on the live database during a build while the
-- old code is serving; the old code never reads or writes them. The checks only restate limits the application applies, and every existing row
-- passes them (all the new columns are null).
--
-- The logo itself is NOT in the database: it is in the private file store under a server-chosen key (logo_key), like a working paper, and is
-- served only through an authenticated route. Only its key, type, size and sha256 are recorded here, never a URL.
--
-- Who may change it: only the firm's administrator, through the sign-in role. app_user (tenant work) keeps its read-only access to firms, so a
-- bug in a page or a partner's request cannot write these columns. app_auth already runs user management with no firm context, re-reading the
-- caller's role from the database (requireAdmin) and acting only on the caller's own firm; it is given UPDATE on these eight columns and no
-- others, so the firm's name and everything else stay untouchable even by that role.
alter table firms add column address text;
alter table firms add column contact_line text;
alter table firms add column registration_line text;
alter table firms add column logo_key text;
alter table firms add column logo_content_type text;
alter table firms add column logo_bytes integer;
alter table firms add column logo_sha256 text;
alter table firms add column branding_updated_at timestamptz;

alter table firms add constraint firms_branding_text_length check (
  (address is null or char_length(address) <= 300)
  and (contact_line is null or char_length(contact_line) <= 200)
  and (registration_line is null or char_length(registration_line) <= 200)
);
-- A logo is all or nothing, in a shape the application writes: the firm's own prefix and a random id, a PNG or a JPEG, up to 1 MB, with its hash.
alter table firms add constraint firms_logo_complete check (
  (logo_key is null and logo_content_type is null and logo_bytes is null and logo_sha256 is null)
  or (
    -- Written with is not null: a check that is NULL passes, so a half-recorded logo would otherwise slip through.
    logo_key is not null and logo_content_type is not null and logo_bytes is not null and logo_sha256 is not null
    and logo_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'
    and split_part(logo_key, '/', 1) = id::text
    and logo_content_type in ('image/png', 'image/jpeg')
    and logo_bytes between 1 and 1048576
    and logo_sha256 ~ '^[0-9a-f]{64}$'
  )
);

grant update (address, contact_line, registration_line, logo_key, logo_content_type, logo_bytes, logo_sha256, branding_updated_at) on firms to app_auth;
