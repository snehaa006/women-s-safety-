-- Phase 1 part B: automatic alerts to the trusted circle, durable timers, live updates over
-- Supabase Realtime, Telegram linking, queued (offline) SOS with the original trigger time, and
-- nearby safe points.
--
-- How an alert travels (docs/02-architecture.md sections 7 and 8):
--   1. start_incident() writes one `alerts` row per contact and channel in the SOS transaction,
--      plus a `sos.reminder` job in private.jobs, then asks pg_net to call the notify function.
--   2. The notify Edge Function claims due alerts (claim_alerts), sends them by email or
--      Telegram, and reports each result (finish_alert), which writes the ledger.
--   3. Supabase Cron runs private.tick() every 5 seconds: it runs due jobs (the 2-minute
--      reminder), retries failed sends, and calls notify again while alerts are waiting.
-- The notify function takes no input and trusts no caller: it only flushes alerts the database
-- already queued, so it can run without a JWT. pg_net and pg_cron come from the previous migration.

-- =============================================================================================
-- Settings and jobs
-- =============================================================================================

create table private.settings (
  key   text primary key,
  value text not null
);

comment on table private.settings is
  'Deployment settings read by database code. Local stacks override them in seed.sql.';

-- The hosted project. A local stack (supabase start) points this at http://kong:8000/functions/v1.
insert into private.settings (key, value) values
  ('functions_url', 'https://fwhhgiajzrzsjeduenaj.supabase.co/functions/v1');

-- Durable timers. A row is a piece of work due at run_at; private.tick() runs it once.
create table private.jobs (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  run_at     timestamptz not null,
  payload    jsonb not null default '{}'::jsonb,
  status     text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts   smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

create index jobs_due_idx on private.jobs (run_at) where status = 'pending';

alter table private.settings enable row level security;
alter table private.jobs enable row level security;

-- =============================================================================================
-- Trusted contacts: Telegram linking
-- =============================================================================================

-- A contact taps t.me/<bot>?start=<telegram_code> once; the bot then knows where to send alerts.
-- The code is rotated after use, so a forwarded invite can't link a second chat.
alter table public.trusted_contacts
  add column telegram_code      text not null default private.new_token(),
  add column telegram_linked_at timestamptz,
  add column telegram_username  text check (char_length(telegram_username) <= 64);

create unique index trusted_contacts_telegram_code_idx on public.trusted_contacts (telegram_code);

-- Browsers insert contacts as themselves and can't run private functions, so new rows get their
-- code from a trigger instead of the column default (which only filled in the existing rows).
alter table public.trusted_contacts alter column telegram_code drop default;

create function private.set_telegram_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.telegram_code := private.new_token();
  return new;
end;
$$;

create trigger trusted_contacts_telegram_code
  before insert on public.trusted_contacts
  for each row execute function private.set_telegram_code();

-- The chat id stays out of the API: only the notify function needs it.
create table private.contact_telegram (
  contact_id uuid primary key references public.trusted_contacts (id) on delete cascade,
  chat_id    bigint not null,
  linked_at  timestamptz not null default now()
);

create index contact_telegram_chat_idx on private.contact_telegram (chat_id);
alter table private.contact_telegram enable row level security;

-- =============================================================================================
-- Incidents and live links
-- =============================================================================================

-- Random name of the public Realtime topic that pings the live-link page. Only people holding a
-- valid link learn it (view_share_link returns it), and its messages carry no data.
alter table public.incidents
  add column live_topic text not null default private.new_token();

-- One link per alerted contact, so the citizen sees who opened it. The first link (audience
-- 'shared') is the one she sends herself.
alter table public.share_links
  add column audience       text not null default 'shared' check (audience in ('shared', 'contact')),
  add column contact_id     uuid references public.trusted_contacts (id) on delete set null,
  add column recipient_name text check (char_length(recipient_name) <= 80);

create index share_links_contact_idx on public.share_links (contact_id);
create unique index share_links_one_per_contact_idx on public.share_links (incident_id, contact_id)
  where contact_id is not null;

-- =============================================================================================
-- Alerts (the outbox the notify function drains)
-- =============================================================================================

create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  citizen_id      uuid not null references public.profiles (id) on delete cascade,
  contact_id      uuid references public.trusted_contacts (id) on delete set null,
  share_link_id   uuid references public.share_links (id) on delete set null,
  recipient_name  text not null,
  level           smallint not null default 0 check (level between 0 and 9),
  template        text not null check (template in ('sos', 'reminder', 'safe')),
  channel         text not null check (channel in ('email', 'telegram')),
  status          text not null default 'queued'
                  check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  acked_at        timestamptz,
  provider_ref    text,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.alerts is
  'One message to one contact on one channel. Addresses are looked up when sending, never stored.';

create index alerts_incident_idx on public.alerts (incident_id, created_at);
create index alerts_citizen_idx on public.alerts (citizen_id);
create index alerts_contact_idx on public.alerts (contact_id);
create index alerts_share_link_idx on public.alerts (share_link_id);
create index alerts_due_idx on public.alerts (next_attempt_at) where status = 'queued';

-- =============================================================================================
-- Safe points (police stations, hospitals) for the SOS screen
-- =============================================================================================

create table public.safe_points (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 160),
  category      text not null check (category in ('police', 'hospital', 'fire_station', 'pharmacy')),
  lat           numeric(9, 6) not null check (lat between -90 and 90),
  lng           numeric(9, 6) not null check (lng between -180 and 180),
  phone         text check (char_length(phone) <= 40),
  address       text check (char_length(address) <= 200),
  opening_hours text check (char_length(opening_hours) <= 120),
  source        text not null check (source in ('osm', 'admin')),
  osm_ref       text unique check (osm_ref ~ '^(node|way|relation)/[0-9]+$'),
  verified      boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.safe_points is
  'Places to run to. source = osm is imported from OpenStreetMap (ODbL, credit it on screen).';

create index safe_points_lat_lng_idx on public.safe_points (lat, lng);

-- =============================================================================================
-- Row-level security and privileges
-- =============================================================================================

alter table public.alerts enable row level security;
alter table public.safe_points enable row level security;

create policy "Citizens read alerts about their SOS" on public.alerts
  for select to authenticated using (citizen_id = (select auth.uid()));

create policy "Anyone reads safe points" on public.safe_points
  for select to anon, authenticated using (true);

revoke all on table public.alerts, public.safe_points from public, anon, authenticated;
grant select on table public.alerts to authenticated;
grant select on table public.safe_points to anon, authenticated;
grant all on table public.alerts, public.safe_points to service_role;

revoke all on table private.settings, private.jobs, private.contact_telegram
  from public, anon, authenticated;

revoke all on function private.set_telegram_code() from public, anon, authenticated;
