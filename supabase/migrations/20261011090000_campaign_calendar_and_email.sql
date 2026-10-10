-- Per-campaign calendar and follow-up e-mail settings.
-- calendar_url: the booking calendar meetings on this campaign are booked in.
-- calendar_token: secret for the campaign's read-only calendar feed (.ics), which
--   the customer can subscribe to in Google Calendar or Outlook.
-- email_*: template the sellers send to a lead after a call.

alter table nordcall.campaigns
  add column if not exists calendar_url text check (calendar_url is null or length(calendar_url) <= 2000),
  add column if not exists calendar_token uuid not null default gen_random_uuid(),
  add column if not exists email_enabled boolean not null default false,
  add column if not exists email_from_name text not null default '' check (length(email_from_name) <= 120),
  add column if not exists email_reply_to text not null default '' check (length(email_reply_to) <= 200),
  add column if not exists email_subject text not null default '' check (length(email_subject) <= 200),
  add column if not exists email_body text not null default '' check (length(email_body) <= 10000);

create unique index if not exists campaigns_calendar_token_idx on nordcall.campaigns (calendar_token);

notify pgrst, 'reload schema';
