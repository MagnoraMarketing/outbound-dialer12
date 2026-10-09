-- Every seller covers the system with the first part of their earnings each
-- calendar month (default 500 DKK). Everything above that is the seller's own.
-- Only administrators change the amount, through the server (service role).
alter table nordcall.teams
  add column if not exists seller_system_fee_dkk numeric(12, 2) not null default 500
    check (seller_system_fee_dkk between 0 and 1000000);

notify pgrst, 'reload schema';
