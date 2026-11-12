-- The part of total borrowings that falls due within twelve months of the reporting date,
-- entered by the preparer so the statement of financial position can show it as current.
alter table engagements add column borrowings_current_minor bigint not null default 0 check (borrowings_current_minor >= 0);
alter table engagements add column borrowings_current_prior_minor bigint not null default 0 check (borrowings_current_prior_minor >= 0);
