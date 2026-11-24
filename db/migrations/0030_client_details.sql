-- Client details: the trade licence, the licensing authority, the tax registration number, the financial year-end, the address and a contact.
--
-- Every column is nullable with no default, so an existing client keeps working with all of them empty and the old code, which never reads them, is
-- unaffected. The shape of each value is checked here as a last line of defence (lengths, 15 digits for the tax registration number, a month and day for
-- the year-end, stored as text 'MM-DD'); the server checks them first, in words a person can read, and refuses 29 February, which a pattern cannot see.
--
-- Additive and safe for db:setup-hosted on the live database: nine metadata-only column additions, no rewrite of the table, no data touched.
alter table clients add column licence_number text check (licence_number is null or length(licence_number) between 1 and 60);
alter table clients add column licensing_authority text check (licensing_authority is null or length(licensing_authority) between 1 and 120);
alter table clients add column tax_registration_number text check (tax_registration_number is null or tax_registration_number ~ '^[0-9]{15}$');
alter table clients add column year_end text check (year_end is null or year_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table clients add column address text check (address is null or length(address) between 1 and 300);
alter table clients add column contact_name text check (contact_name is null or length(contact_name) between 1 and 120);
alter table clients add column contact_email text check (contact_email is null or length(contact_email) between 3 and 200);
