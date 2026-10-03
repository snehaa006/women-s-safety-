-- Phase 2, step 1: where responders are and how incidents reach them.
--
-- Stations get a location and a jurisdiction polygon (PostGIS), patrol units, and an escalation
-- policy stored as data. Incidents get the authority side of their life: the station handling
-- them, acknowledgement, dispatch, arrival, escalation level and the officer's closing code.

create extension if not exists postgis with schema extensions;

-- =============================================================================================
-- Stations: location and jurisdiction
-- =============================================================================================

alter table public.organizations
  add column location     extensions.geography(Point, 4326),
  add column jurisdiction extensions.geography(MultiPolygon, 4326);

comment on column public.organizations.jurisdiction is
  'Area this station answers for. An SOS inside it goes here; otherwise to the nearest station.';

create index organizations_jurisdiction_idx on public.organizations using gist (jurisdiction);
create index organizations_location_idx on public.organizations using gist (location);

-- The demo district: central New Delhi, with real station locations (OpenStreetMap) and simple
-- rectangular jurisdictions. The ids are the ones seed.sql has always used.
insert into public.organizations (id, name, type, parent_id, phone, location, jurisdiction) values
  ('00000000-0000-4000-8000-000000000001', 'New Delhi District Control Room', 'control_room', null,
   '112', 'SRID=4326;POINT(77.2167 28.6315)',
   'SRID=4326;MULTIPOLYGON(((77.16 28.58,77.26 28.58,77.26 28.66,77.16 28.66,77.16 28.58)))'),
  ('00000000-0000-4000-8000-000000000011', 'Connaught Place Police Station', 'police_station',
   '00000000-0000-4000-8000-000000000001', '+91-11-2374-7100', 'SRID=4326;POINT(77.214186 28.629855)',
   'SRID=4326;MULTIPOLYGON(((77.209 28.622,77.26 28.622,77.26 28.66,77.209 28.66,77.209 28.622)))'),
  ('00000000-0000-4000-8000-000000000012', 'Tilak Marg Police Station', 'police_station',
   '00000000-0000-4000-8000-000000000001', '+91-11-2338-5571', 'SRID=4326;POINT(77.235502 28.617878)',
   'SRID=4326;MULTIPOLYGON(((77.222 28.59,77.26 28.59,77.26 28.622,77.222 28.622,77.222 28.59)))'),
  ('00000000-0000-4000-8000-000000000013', 'Chanakyapuri Police Station', 'police_station',
   '00000000-0000-4000-8000-000000000001', null, 'SRID=4326;POINT(77.196013 28.602802)',
   'SRID=4326;MULTIPOLYGON(((77.16 28.58,77.222 28.58,77.222 28.63,77.16 28.63,77.16 28.58)))'),
  ('00000000-0000-4000-8000-000000000014', 'Mandir Marg Police Station', 'police_station',
   '00000000-0000-4000-8000-000000000001', null, 'SRID=4326;POINT(77.20257 28.638344)',
   'SRID=4326;MULTIPOLYGON(((77.16 28.63,77.209 28.63,77.209 28.66,77.16 28.66,77.16 28.63)))'),
  ('00000000-0000-4000-8000-000000000021', 'Demo College Security Desk', 'campus_security',
   '00000000-0000-4000-8000-000000000011', null, 'SRID=4326;POINT(77.2120 28.6330)', null)
on conflict (id) do update
  set name = excluded.name, type = excluded.type, parent_id = excluded.parent_id,
      phone = excluded.phone, location = excluded.location, jurisdiction = excluded.jurisdiction;

-- =============================================================================================
-- Patrol units
-- =============================================================================================

create table public.patrol_units (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  call_sign    text not null check (char_length(btrim(call_sign)) between 1 and 30),
  kind         text not null default 'pcr_van' check (kind in ('pcr_van', 'bike', 'foot', 'campus')),
  status       text not null default 'available'
               check (status in ('available', 'dispatched', 'on_scene', 'off_duty')),
  last_lat     numeric(9, 6),
  last_lng     numeric(9, 6),
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, call_sign)
);

create index patrol_units_org_idx on public.patrol_units (org_id, status);

insert into public.patrol_units (org_id, call_sign, kind, last_lat, last_lng) values
  ('00000000-0000-4000-8000-000000000011', 'CP-PCR-1', 'pcr_van', 28.6310, 77.2160),
  ('00000000-0000-4000-8000-000000000011', 'CP-BIKE-2', 'bike', 28.6335, 77.2195),
  ('00000000-0000-4000-8000-000000000012', 'TM-PCR-1', 'pcr_van', 28.6170, 77.2340),
  ('00000000-0000-4000-8000-000000000013', 'CK-PCR-1', 'pcr_van', 28.6020, 77.1965),
  ('00000000-0000-4000-8000-000000000014', 'MM-PCR-1', 'pcr_van', 28.6380, 77.2030),
  ('00000000-0000-4000-8000-000000000001', 'ND-QRT-1', 'pcr_van', 28.6280, 77.2200)
on conflict (org_id, call_sign) do nothing;

-- =============================================================================================
-- Escalation policies (data, not code)
-- =============================================================================================

-- levels: [{"after_s": 120, "to": "station"}, {"after_s": 300, "to": "parent"}]
--   after_s  seconds after the SOS started
--   to       station: the station's supervisors and duty officers are alerted again
--            parent:  the parent organisation (district control room) sees and owns it
-- After the last level the alert repeats every repeat_s, and oversight is flagged.
create table public.escalation_policies (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid unique references public.organizations (id) on delete cascade,
  levels     jsonb not null check (jsonb_typeof(levels) = 'array'
                                   and jsonb_array_length(levels) between 1 and 5),
  repeat_s   integer not null default 120 check (repeat_s between 60 and 3600),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.escalation_policies is
  'Escalation ladder per organisation; the row with org_id null is the default for everyone.';

create unique index escalation_policies_default_idx on public.escalation_policies ((org_id is null))
  where org_id is null;

insert into public.escalation_policies (org_id, levels, repeat_s)
select null, '[{"after_s": 120, "to": "station"}, {"after_s": 300, "to": "parent"}]'::jsonb, 120
where not exists (select 1 from public.escalation_policies where org_id is null);

-- =============================================================================================
-- Incidents: the authority side
-- =============================================================================================

alter table public.incidents
  add column assigned_org_id  uuid references public.organizations (id),
  add column routed_at        timestamptz,
  add column response_state   text not null default 'unacknowledged'
             check (response_state in ('unacknowledged', 'acknowledged', 'responding', 'on_scene')),
  add column escalation_level smallint not null default 0 check (escalation_level between 0 and 50),
  add column escalated_at     timestamptz,
  add column acknowledged_at  timestamptz,
  add column acknowledged_by  uuid references public.profiles (id) on delete set null,
  add column unit_id          uuid references public.patrol_units (id) on delete set null,
  add column dispatched_at    timestamptz,
  add column eta_at           timestamptz,
  add column arrived_at       timestamptz,
  add column close_code       text check (close_code in (
               'user_safe', 'assisted_on_scene', 'transferred_to_case', 'false_alarm', 'duplicate')),
  add column close_note       text check (char_length(close_note) <= 500),
  add column closed_by        uuid references public.profiles (id) on delete set null,
  add column is_demo          boolean not null default false;

comment on column public.incidents.close_code is
  'Set when staff close the incident. resolution stays the citizen''s own answer.';

create index incidents_org_active_idx on public.incidents (assigned_org_id) where status = 'active';
create index incidents_ack_by_idx on public.incidents (acknowledged_by);
create index incidents_unit_idx on public.incidents (unit_id);
create index incidents_closed_by_idx on public.incidents (closed_by);

-- Every escalation step, for the board, the reviews and the golden-hour metrics.
create table public.incident_escalations (
  id          bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  level       smallint not null,
  target      text not null check (target in ('station', 'parent', 'oversight')),
  org_id      uuid references public.organizations (id),
  at          timestamptz not null default now()
);

create index incident_escalations_incident_idx on public.incident_escalations (incident_id, level);
create index incident_escalations_org_idx on public.incident_escalations (org_id);

-- Closed until the next steps add the policies that need their helper functions.
alter table public.patrol_units enable row level security;
alter table public.escalation_policies enable row level security;
alter table public.incident_escalations enable row level security;
revoke all on table public.patrol_units, public.escalation_policies, public.incident_escalations
  from public, anon, authenticated;
