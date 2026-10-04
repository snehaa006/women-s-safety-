-- Phase 5: safe maps and journey monitoring (docs/02-architecture.md §10, docs/03-workflows.md
-- §11).
--
-- Risk lives in grid cells of 0.003° (about 330 m × 290 m in Delhi; Supabase has no H3
-- extension, so a plain lat/lng grid stands in for H3 resolution 9). An hourly job scores each
-- cell for day and night from complaints, SOS events and citizens' zone reports, fading with age;
-- safe points lower the score. Only cells with at least k signals (default 3) are ever shown.
--
-- A journey sends a ping every 15 s (5 s in a high-risk cell at night). A watchdog job checks it:
-- off the route by more than 150 m for 60 s, or stopped for 3 minutes away from a safe point or
-- the destination, asks "Are you OK?" (PIN within 60 s); no answer, the duress PIN, or 45 s
-- without a ping raise an SOS, which alerts the circle with the live link and reaches the
-- station's board.

-- =============================================================================================
-- Grid helpers
-- =============================================================================================

insert into private.settings (key, value) values
  ('risk_cell_deg', '0.003'),
  ('risk_min_signals', '3')
on conflict (key) do nothing;

create function private.cell_deg()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value::numeric from private.settings where key = 'risk_cell_deg'), 0.003)
$$;

create function private.risk_min_signals()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value::integer from private.settings where key = 'risk_min_signals'), 3)
$$;

-- Night is 19:00 to 06:00 in India.
create function private.is_night(p_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(hour from p_at at time zone 'Asia/Kolkata') >= 19
      or extract(hour from p_at at time zone 'Asia/Kolkata') < 6
$$;

create function private.point(p_lat numeric, p_lng numeric)
returns extensions.geography
language sql
immutable
set search_path = ''
as $$
  select extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326)::extensions.geography
$$;

-- =============================================================================================
-- Tables
-- =============================================================================================

-- "This place feels unsafe": a citizen's report about a spot, not about a person.
create table public.zone_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete cascade,
  kind        text not null
              check (kind in ('poor_lighting', 'isolated', 'harassment', 'unsafe_crowd', 'no_transport', 'other')),
  lat         numeric(9, 6) not null check (lat between -90 and 90),
  lng         numeric(9, 6) not null check (lng between -180 and 180),
  at_night    boolean not null,
  note        text check (char_length(note) <= 300),
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  check (is_demo or reporter_id is not null)
);

create index zone_reports_reporter_idx on public.zone_reports (reporter_id, created_at);
create index zone_reports_lat_lng_idx on public.zone_reports (lat, lng);

-- Aggregated risk. Individual reports, complaints and SOS pins are never shown on the map.
create table public.risk_cells (
  cell_x      integer not null,
  cell_y      integer not null,
  period      text not null check (period in ('day', 'night')),
  score       numeric(8, 2) not null,
  level       text not null check (level in ('low', 'medium', 'high')),
  signals     integer not null,
  factors     jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null,
  primary key (cell_x, cell_y, period)
);

create table public.journeys (
  id                  uuid primary key default gen_random_uuid(),
  citizen_id          uuid not null references public.profiles (id) on delete cascade,
  client_id           uuid,
  status              text not null default 'active'
                      check (status in ('active', 'arrived', 'cancelled', 'escalated')),
  dest_lat            numeric(9, 6) not null check (dest_lat between -90 and 90),
  dest_lng            numeric(9, 6) not null check (dest_lng between -180 and 180),
  dest_name           text check (char_length(dest_name) <= 120),
  route               extensions.geography(LineString, 4326),
  route_label         text check (route_label in ('safest', 'fastest', 'direct')),
  expected_arrival_at timestamptz,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  last_ping_at        timestamptz,
  last_lat            numeric(9, 6),
  last_lng            numeric(9, 6),
  last_accuracy_m     numeric(8, 1),
  -- Where the person last moved more than 25 m from, and when.
  moved_lat           numeric(9, 6),
  moved_lng           numeric(9, 6),
  last_moved_at       timestamptz,
  off_route_since     timestamptz,
  off_route_m         numeric(10, 1),
  monitoring          text not null default 'normal' check (monitoring in ('normal', 'active')),
  check_in_due_at     timestamptz,
  check_in_reason     text check (check_in_reason in ('off_route', 'stopped')),
  incident_id         uuid references public.incidents (id) on delete set null,
  escalation_reason   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (citizen_id, client_id)
);

create unique index journeys_one_active_idx on public.journeys (citizen_id) where status = 'active';
create index journeys_citizen_idx on public.journeys (citizen_id, started_at desc);
create index journeys_incident_idx on public.journeys (incident_id);

create trigger journeys_touch
  before update on public.journeys
  for each row execute function private.touch_updated_at();

-- The path walked, for the journey screen. Kept only while the journey matters to its owner.
create table public.journey_points (
  id         bigint generated always as identity primary key,
  journey_id uuid not null references public.journeys (id) on delete cascade,
  lat        numeric(9, 6) not null,
  lng        numeric(9, 6) not null,
  accuracy_m numeric(8, 1),
  at         timestamptz not null default now()
);

create index journey_points_journey_idx on public.journey_points (journey_id, at);

alter table public.zone_reports enable row level security;
alter table public.risk_cells enable row level security;
alter table public.journeys enable row level security;
alter table public.journey_points enable row level security;

create policy "Citizens read their own journeys" on public.journeys
  for select to authenticated
  using (citizen_id = (select auth.uid()));

create policy "Citizens read their own journey points" on public.journey_points
  for select to authenticated
  using (exists (select 1 from public.journeys j
                 where j.id = journey_id and j.citizen_id = (select auth.uid())));

revoke all on table public.zone_reports, public.risk_cells, public.journeys, public.journey_points
  from public, anon, authenticated;
grant select on table public.journeys, public.journey_points to authenticated;
grant all on table public.zone_reports, public.risk_cells, public.journeys, public.journey_points
  to service_role;

-- =============================================================================================
-- Risk cells
-- =============================================================================================

-- Recomputes every cell for day and night. Signals fade with a 30-day half-life; a signal counts
-- fully in its own period and 30% in the other. Poor lighting only matters at night.
create function private.compute_risk_cells(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deg   numeric := private.cell_deg();
  v_count integer;
begin
  with signals as (
    select c.lat, c.lng, 'complaints'::text as factor,
           c.severity::numeric as weight,
           private.is_night(coalesce(c.occurred_at, c.created_at)) as night,
           coalesce(c.occurred_at, c.created_at) as at
    from public.complaints c
    where c.lat is not null
    union all
    select i.last_lat, i.last_lng, 'sos', 4, private.is_night(i.started_at), i.started_at
    from public.incidents i
    where i.last_lat is not null and coalesce(i.resolution, '') <> 'false_alarm'
    union all
    select z.lat, z.lng, 'zone:' || z.kind, 2, z.at_night, z.created_at
    from public.zone_reports z
  ), weighted as (
    select floor(s.lng / v_deg)::integer as cell_x, floor(s.lat / v_deg)::integer as cell_y,
           p.period, s.factor,
           s.weight * power(0.5, greatest(extract(epoch from p_now - s.at), 0) / (30 * 86400))
             * case when (p.period = 'night') = s.night then 1 else 0.3 end
             * case when s.factor = 'zone:poor_lighting' and p.period = 'day' then 0 else 1 end
             as w
    from signals s
    cross join (values ('day'), ('night')) p(period)
  ), by_factor as (
    select cell_x, cell_y, period, factor, sum(w) as w, count(*) filter (where w > 0) as n
    from weighted
    group by cell_x, cell_y, period, factor
  ), cells as (
    select cell_x, cell_y, period, sum(w) as raw, sum(n)::integer as signals,
           jsonb_object_agg(factor, n) filter (where n > 0) as factors
    from by_factor
    group by cell_x, cell_y, period
  ), havens as (
    select floor(sp.lng / v_deg)::integer as cell_x, floor(sp.lat / v_deg)::integer as cell_y,
           least(count(*), 3) as n
    from public.safe_points sp
    group by 1, 2
  )
  insert into public.risk_cells (cell_x, cell_y, period, score, level, signals, factors, computed_at)
  select c.cell_x, c.cell_y, c.period,
         round(greatest(c.raw - coalesce(h.n, 0), 0), 2),
         case when c.raw - coalesce(h.n, 0) >= 10 then 'high'
              when c.raw - coalesce(h.n, 0) >= 4 then 'medium'
              else 'low' end,
         c.signals,
         coalesce(c.factors, '{}'::jsonb) || jsonb_build_object('safe_points', coalesce(h.n, 0)),
         p_now
  from cells c
  left join havens h using (cell_x, cell_y)
  where c.signals > 0
  on conflict (cell_x, cell_y, period) do update
    set score = excluded.score, level = excluded.level, signals = excluded.signals,
        factors = excluded.factors, computed_at = excluded.computed_at;
  get diagnostics v_count = row_count;
  -- Cells whose signals all faded or went away drop to nothing (never shown).
  update public.risk_cells
     set score = 0, level = 'low', signals = 0, factors = '{}'::jsonb, computed_at = p_now
   where computed_at < p_now;
  return v_count;
end;
$$;

-- The level of the cell a point is in, for a period. Cells under k signals count as low.
create function private.cell_level(p_lat numeric, p_lng numeric, p_period text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.level from public.risk_cells r
    where r.cell_x = floor(p_lng / private.cell_deg())::integer
      and r.cell_y = floor(p_lat / private.cell_deg())::integer
      and r.period = p_period and r.signals >= private.risk_min_signals()
  ), 'low')
$$;

-- The map: aggregated cells only, each with its bounds and why it is red.
create function public.risk_map(p_period text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period text := coalesce(p_period, case when private.is_night(now()) then 'night' else 'day' end);
  v_deg    numeric := private.cell_deg();
begin
  if auth.uid() is null then
    raise exception 'Sign in to see the map' using errcode = 'insufficient_privilege';
  end if;
  if v_period not in ('day', 'night') then
    raise exception 'Choose day or night' using errcode = 'invalid_parameter_value';
  end if;
  return jsonb_build_object(
    'period', v_period,
    'cell_deg', v_deg,
    'min_signals', private.risk_min_signals(),
    'computed_at', (select max(computed_at) from public.risk_cells),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
               'x', r.cell_x, 'y', r.cell_y, 'level', r.level, 'score', r.score,
               'signals', r.signals, 'factors', r.factors,
               'bounds', jsonb_build_array(r.cell_x * v_deg, r.cell_y * v_deg,
                                           (r.cell_x + 1) * v_deg, (r.cell_y + 1) * v_deg))
             order by r.score desc)
      from public.risk_cells r
      where r.period = v_period and r.signals >= private.risk_min_signals()
        and r.level <> 'low'
    ), '[]'::jsonb)
  );
end;
$$;

-- A citizen's zone report. Twenty a day at most.
create function public.report_zone(
  p_lat      numeric,
  p_lng      numeric,
  p_kind     text,
  p_at_night boolean default null,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to report a place' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Choose a place on the map' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from public.zone_reports
      where reporter_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have reported 20 places today; thank you' using errcode = 'check_violation';
  end if;
  insert into public.zone_reports (reporter_id, kind, lat, lng, at_night, note)
  values (v_uid, p_kind, p_lat, p_lng, coalesce(p_at_night, private.is_night(now())),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  perform private.ledger_append(
    p_action       => 'zone.reported',
    p_subject_type => 'zone_report',
    p_subject_id   => v_id,
    p_payload      => jsonb_build_object('kind', p_kind),
    p_lat          => p_lat,
    p_lng          => p_lng
  );
  return jsonb_build_object('report_id', v_id);
end;
$$;

-- Scores route alternatives by risk exposure: for each sampled point (the app samples about every
-- 50 m), the score of its cell in the period of p_at. Lists the high and medium cells crossed and
-- the safe points within 150 m of the route.
create function public.score_routes(p_routes jsonb, p_at timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period text := case when private.is_night(coalesce(p_at, now())) then 'night' else 'day' end;
  v_deg    numeric := private.cell_deg();
  v_min    integer := private.risk_min_signals();
begin
  if auth.uid() is null then
    raise exception 'Sign in to plan a route' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_routes) <> 'array' or jsonb_array_length(p_routes) not between 1 and 8 then
    raise exception 'Send 1 to 8 routes' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from jsonb_array_elements(p_routes) r
             where jsonb_typeof(r) <> 'array' or jsonb_array_length(r) not between 2 and 2000) then
    raise exception 'Each route needs 2 to 2000 points' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object('period', v_period, 'routes', (
    select jsonb_agg(jsonb_build_object(
             'index', r.ordinality - 1,
             'exposure', coalesce((
               select round(sum(c.score), 2)
               from jsonb_array_elements(r.value) p
               join public.risk_cells c
                 on c.cell_x = floor((p ->> 0)::numeric / v_deg)::integer
                and c.cell_y = floor((p ->> 1)::numeric / v_deg)::integer
                and c.period = v_period and c.signals >= v_min), 0),
             'high_cells', (
               select count(distinct (c.cell_x, c.cell_y))
               from jsonb_array_elements(r.value) p
               join public.risk_cells c
                 on c.cell_x = floor((p ->> 0)::numeric / v_deg)::integer
                and c.cell_y = floor((p ->> 1)::numeric / v_deg)::integer
                and c.period = v_period and c.signals >= v_min and c.level = 'high'),
             'medium_cells', (
               select count(distinct (c.cell_x, c.cell_y))
               from jsonb_array_elements(r.value) p
               join public.risk_cells c
                 on c.cell_x = floor((p ->> 0)::numeric / v_deg)::integer
                and c.cell_y = floor((p ->> 1)::numeric / v_deg)::integer
                and c.period = v_period and c.signals >= v_min and c.level = 'medium'),
             'safe_points', coalesce((
               select jsonb_agg(jsonb_build_object('name', sp.name, 'category', sp.category,
                                                   'lat', sp.lat, 'lng', sp.lng))
               from public.safe_points sp
               where extensions.st_dwithin(
                 private.point(sp.lat, sp.lng),
                 (select extensions.st_makeline(array_agg(
                           extensions.st_setsrid(extensions.st_makepoint((p ->> 0)::float8, (p ->> 1)::float8), 4326)
                           order by po))::extensions.geography
                  from jsonb_array_elements(r.value) with ordinality q(p, po)),
                 150)
             ), '[]'::jsonb)) order by r.ordinality)
    from jsonb_array_elements(p_routes) with ordinality r(value, ordinality)
  ));
end;
$$;
