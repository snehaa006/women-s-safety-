-- Phase 1: trusted circle, silent SOS, live location, live links and the wearable API.
--
-- Browsers write only their own contacts directly. Everything else goes through the RPCs below,
-- which check ownership, keep the rules in one place and write the ledger in the same
-- transaction. Wearables (and the virtual wearable used until the hardware exists) call
-- device_event() with an HMAC signature instead of a user session.

-- =============================================================================================
-- Helpers
-- =============================================================================================

-- URL-safe random token with 144 bits of entropy (24 characters, no padding).
create function private.new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
$$;

-- =============================================================================================
-- Trusted circle
-- =============================================================================================

create table public.trusted_contacts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  phone        text check (phone ~ '^\+?[0-9][0-9 ()-]{5,19}$'),
  email        text check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  relationship text check (char_length(relationship) <= 40),
  priority     smallint not null default 1 check (priority between 1 and 99),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trusted_contacts_reachable check (phone is not null or email is not null)
);

comment on table public.trusted_contacts is
  'The people alerted when the owner triggers SOS, lowest priority number first.';

create index trusted_contacts_owner_idx on public.trusted_contacts (owner_id, priority);

create trigger trusted_contacts_touch
  before update on public.trusted_contacts
  for each row execute function private.touch_updated_at();

-- Runs as the caller, so the count sees only the caller's own contacts.
create function private.limit_trusted_contacts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.trusted_contacts where owner_id = new.owner_id) >= 10 then
    raise exception 'You can have up to 10 trusted contacts' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trusted_contacts_limit
  before insert on public.trusted_contacts
  for each row execute function private.limit_trusted_contacts();

-- =============================================================================================
-- Devices (wearables and the virtual wearable)
-- =============================================================================================

create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  kind         text not null check (kind in ('simulator', 'keychain')),
  status       text not null default 'active' check (status in ('active', 'tamper')),
  battery_pct  smallint check (battery_pct between 0 and 100),
  last_seen_at timestamptz,
  last_lat     numeric(9, 6),
  last_lng     numeric(9, 6),
  created_at   timestamptz not null default now()
);

comment on table public.devices is
  'Paired wearables. kind = simulator is the virtual wearable in the app; it uses the same API.';

create index devices_owner_idx on public.devices (owner_id);

-- The HMAC key. Postgres verifies signatures itself, so the key never leaves the database after
-- pairing. Not exposed through the API.
create table private.device_secrets (
  device_id  uuid primary key references public.devices (id) on delete cascade,
  secret     text not null,
  rotated_at timestamptz not null default now()
);

-- =============================================================================================
-- Incidents, location and live links
-- =============================================================================================

create table public.incidents (
  id                   uuid primary key default gen_random_uuid(),
  citizen_id           uuid not null references public.profiles (id) on delete cascade,
  source               text not null check (source in ('app', 'device', 'simulator')),
  device_id            uuid references public.devices (id) on delete set null,
  client_id            uuid,
  status               text not null default 'active' check (status in ('active', 'resolved')),
  started_at           timestamptz not null default now(),
  -- When the citizen last closed it ("I'm safe"). With the duress PIN this is set while status
  -- stays active, so her screen shows "safe" and everyone else still sees an active SOS.
  closed_by_citizen_at timestamptz,
  resolved_at          timestamptz,
  resolution           text check (resolution in ('safe', 'false_alarm')),
  last_lat             numeric(9, 6),
  last_lng             numeric(9, 6),
  last_accuracy_m      numeric,
  last_battery_pct     smallint,
  last_location_at     timestamptz,
  ledger_batch_at      timestamptz not null default now(),
  unique (citizen_id, client_id)
);

comment on column public.incidents.client_id is
  'Idempotency key from the client: a retried SOS request returns the same incident.';
comment on column public.incidents.ledger_batch_at is
  'Location pings since this time are not yet sealed in the ledger (one batch entry per minute).';

-- One active SOS per person. Pressing again while active reuses it.
create unique index incidents_one_active_idx on public.incidents (citizen_id)
  where status = 'active';
create index incidents_citizen_idx on public.incidents (citizen_id, started_at desc);

create table public.location_pings (
  id          bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  citizen_id  uuid not null references public.profiles (id) on delete cascade,
  at          timestamptz not null default now(),
  lat         numeric(9, 6) not null check (lat between -90 and 90),
  lng         numeric(9, 6) not null check (lng between -180 and 180),
  accuracy_m  numeric check (accuracy_m >= 0),
  speed_mps   numeric check (speed_mps >= 0),
  heading_deg numeric check (heading_deg >= 0 and heading_deg < 360),
  battery_pct smallint check (battery_pct between 0 and 100),
  source      text not null check (source in ('app', 'device', 'simulator'))
);

create index location_pings_incident_idx on public.location_pings (incident_id, at);
create index location_pings_citizen_idx on public.location_pings (citizen_id);

-- The link trusted contacts open without an account (/t/:token).
create table public.share_links (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  citizen_id      uuid not null references public.profiles (id) on delete cascade,
  token           text not null unique default private.new_token(),
  created_at      timestamptz not null default now(),
  first_viewed_at timestamptz,
  expires_at      timestamptz
);

comment on column public.share_links.expires_at is 'Set to 24 hours after the SOS is resolved.';

create index share_links_incident_idx on public.share_links (incident_id);
create index share_links_citizen_idx on public.share_links (citizen_id);

create table public.incident_responders (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.incidents (id) on delete cascade,
  citizen_id    uuid not null references public.profiles (id) on delete cascade,
  share_link_id uuid references public.share_links (id) on delete set null,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  created_at    timestamptz not null default now()
);

create index incident_responders_incident_idx on public.incident_responders (incident_id);
create index incident_responders_citizen_idx on public.incident_responders (citizen_id);
create index incident_responders_link_idx on public.incident_responders (share_link_id);

create table public.device_events (
  id          bigint generated always as identity primary key,
  device_id   uuid not null references public.devices (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  type        text not null
              check (type in ('sos', 'location', 'heartbeat', 'gesture', 'tamper', 'battery_low')),
  nonce       text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  lat         numeric(9, 6),
  lng         numeric(9, 6),
  accuracy_m  numeric,
  battery_pct smallint,
  payload     jsonb not null default '{}'::jsonb,
  incident_id uuid references public.incidents (id) on delete set null,
  unique (device_id, nonce)
);

create index device_events_device_idx on public.device_events (device_id, received_at desc);
create index device_events_owner_idx on public.device_events (owner_id);
create index device_events_incident_idx on public.device_events (incident_id);
create index incidents_device_idx on public.incidents (device_id);

-- =============================================================================================
-- SOS PINs (private)
-- =============================================================================================

create table private.sos_pins (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  sos_pin_hash    text not null,
  duress_pin_hash text,
  updated_at      timestamptz not null default now()
);

create table private.pin_failures (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at      timestamptz not null default now()
);

create index pin_failures_user_idx on private.pin_failures (user_id, at);

-- Incidents closed with the duress PIN. Kept out of the citizen-readable tables.
create table private.incident_duress (
  incident_id uuid primary key references public.incidents (id) on delete cascade,
  at          timestamptz not null default now()
);

alter table private.device_secrets enable row level security;
alter table private.sos_pins enable row level security;
alter table private.pin_failures enable row level security;
alter table private.incident_duress enable row level security;

-- Five wrong PINs within ten minutes lock "I'm safe" and PIN changes for ten minutes.
create function private.pin_locked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= 5
  from private.pin_failures
  where user_id = p_user_id and at > now() - interval '10 minutes'
$$;

create function private.pin_matches(p_pin text, p_hash text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_pin is not null and p_hash is not null and extensions.crypt(p_pin, p_hash) = p_hash
$$;

-- =============================================================================================
-- Internal SOS logic, shared by the app RPCs and the device API
-- =============================================================================================

create function private.add_ping(
  p_incident_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy_m  numeric,
  p_speed_mps   numeric,
  p_heading_deg numeric,
  p_battery_pct integer,
  p_source      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_count    bigint;
  v_hash     text;
begin
  update public.incidents
     set last_lat = p_lat,
         last_lng = p_lng,
         last_accuracy_m = p_accuracy_m,
         last_battery_pct = coalesce(p_battery_pct, last_battery_pct),
         last_location_at = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.location_pings (
    incident_id, citizen_id, lat, lng, accuracy_m, speed_mps, heading_deg, battery_pct, source
  ) values (
    p_incident_id, v_incident.citizen_id, p_lat, p_lng, p_accuracy_m, p_speed_mps, p_heading_deg,
    p_battery_pct, p_source
  );

  -- Pings are not ledgered one by one. Once a minute, one entry seals the hash of the batch.
  if v_incident.ledger_batch_at <= now() - interval '60 seconds' then
    select count(*),
           private.ledger_sha256(string_agg(
             concat_ws(',', to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       lat, lng, accuracy_m, source),
             '|' order by id))
      into v_count, v_hash
      from public.location_pings
     where incident_id = p_incident_id and at > v_incident.ledger_batch_at;

    perform private.ledger_append(
      p_action       => 'location.batch',
      p_subject_type => 'incident',
      p_subject_id   => p_incident_id,
      p_payload      => jsonb_build_object(
                          'pings', v_count, 'sha256', v_hash,
                          'from', v_incident.ledger_batch_at, 'to', now()),
      p_lat          => p_lat,
      p_lng          => p_lng,
      p_accuracy_m   => p_accuracy_m,
      p_actor_id     => v_incident.citizen_id
    );
    update public.incidents set ledger_batch_at = now() where id = p_incident_id;
  end if;
end;
$$;

create function private.start_incident(
  p_citizen_id  uuid,
  p_source      text,
  p_client_id   uuid default null,
  p_device_id   uuid default null,
  p_lat         numeric default null,
  p_lng         numeric default null,
  p_accuracy_m  numeric default null,
  p_battery_pct integer default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_token    text;
  v_has_fix  boolean := p_lat is not null and p_lng is not null;
begin
  -- One SOS at a time per person, even when the app and a wearable fire together.
  perform pg_advisory_xact_lock(hashtext('sos:' || p_citizen_id::text));

  -- A retried request (same client id) gets the same answer and changes nothing.
  if p_client_id is not null then
    select * into v_incident
    from public.incidents
    where citizen_id = p_citizen_id and client_id = p_client_id;
    if found then
      select token into v_token from public.share_links
      where incident_id = v_incident.id order by created_at limit 1;
      return jsonb_build_object('incident_id', v_incident.id, 'share_token', v_token,
                                'created', false);
    end if;
  end if;

  -- Pressed again while an SOS is active: keep the same incident. If it had been closed with the
  -- duress PIN, it becomes visibly active again.
  select * into v_incident
  from public.incidents
  where citizen_id = p_citizen_id and status = 'active';
  if found then
    update public.incidents set closed_by_citizen_at = null where id = v_incident.id;
    perform private.ledger_append(
      p_action       => 'sos.retriggered',
      p_subject_type => 'incident',
      p_subject_id   => v_incident.id,
      p_payload      => jsonb_build_object('source', p_source),
      p_occurred_at  => p_occurred_at,
      p_lat          => p_lat,
      p_lng          => p_lng,
      p_accuracy_m   => p_accuracy_m,
      p_device_id    => p_device_id,
      p_actor_id     => p_citizen_id
    );
    if v_has_fix then
      perform private.add_ping(v_incident.id, p_lat, p_lng, p_accuracy_m, null, null,
                               p_battery_pct, p_source);
    end if;
    select token into v_token from public.share_links
    where incident_id = v_incident.id order by created_at limit 1;
    return jsonb_build_object('incident_id', v_incident.id, 'share_token', v_token,
                              'created', false);
  end if;

  insert into public.incidents (citizen_id, source, client_id, device_id)
  values (p_citizen_id, p_source, p_client_id, p_device_id)
  returning * into v_incident;

  insert into public.share_links (incident_id, citizen_id)
  values (v_incident.id, p_citizen_id)
  returning token into v_token;

  perform private.ledger_append(
    p_action       => 'sos.triggered',
    p_subject_type => 'incident',
    p_subject_id   => v_incident.id,
    p_payload      => jsonb_strip_nulls(jsonb_build_object(
                        'source', p_source, 'battery_pct', p_battery_pct)),
    p_occurred_at  => p_occurred_at,
    p_lat          => p_lat,
    p_lng          => p_lng,
    p_accuracy_m   => p_accuracy_m,
    p_device_id    => p_device_id,
    p_actor_id     => p_citizen_id
  );

  if v_has_fix then
    perform private.add_ping(v_incident.id, p_lat, p_lng, p_accuracy_m, null, null,
                             p_battery_pct, p_source);
  end if;

  return jsonb_build_object('incident_id', v_incident.id, 'share_token', v_token,
                            'created', true);
end;
$$;

-- =============================================================================================
-- RPCs for the citizen app
-- =============================================================================================

create function public.create_sos(
  p_client_id   uuid default null,
  p_lat         numeric default null,
  p_lng         numeric default null,
  p_accuracy_m  numeric default null,
  p_battery_pct integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to send an SOS' using errcode = 'insufficient_privilege';
  end if;
  return private.start_incident(
    p_citizen_id  => auth.uid(),
    p_source      => 'app',
    p_client_id   => p_client_id,
    p_lat         => p_lat,
    p_lng         => p_lng,
    p_accuracy_m  => p_accuracy_m,
    p_battery_pct => p_battery_pct
  );
end;
$$;

comment on function public.create_sos is
  'Start an SOS (or return the active one). Returns {incident_id, share_token, created}.';

create function public.record_location(
  p_incident_id uuid,
  p_lat         numeric,
  p_lng         numeric,
  p_accuracy_m  numeric default null,
  p_speed_mps   numeric default null,
  p_heading_deg numeric default null,
  p_battery_pct integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.incidents
  where id = p_incident_id and citizen_id = auth.uid();
  if not found then
    raise exception 'No such SOS' using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'This SOS has ended' using errcode = 'check_violation';
  end if;
  perform private.add_ping(p_incident_id, p_lat, p_lng, p_accuracy_m, p_speed_mps,
                           p_heading_deg, p_battery_pct, 'app');
end;
$$;

-- "I'm safe". Returns {status: resolved | wrong_pin | locked, keep_sharing}. The duress PIN gets
-- the same "resolved" answer, but the SOS stays active and keep_sharing tells the app to keep
-- sending location quietly. Wrong PINs return a status instead of raising, so the failed attempt
-- is recorded.
create function public.resolve_incident(
  p_incident_id uuid,
  p_pin         text default null,
  p_resolution  text default 'safe'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_incident public.incidents;
  v_pins     private.sos_pins;
  v_has_pin  boolean;
begin
  if p_resolution not in ('safe', 'false_alarm') then
    raise exception 'Unknown resolution %', p_resolution using errcode = 'invalid_parameter_value';
  end if;

  select * into v_incident
  from public.incidents
  where id = p_incident_id and citizen_id = v_uid
  for update;
  if not found then
    raise exception 'No such SOS' using errcode = 'no_data_found';
  end if;

  if v_incident.status <> 'active' or v_incident.closed_by_citizen_at is not null then
    return jsonb_build_object('status', 'resolved', 'keep_sharing', false);
  end if;

  if private.pin_locked(v_uid) then
    return jsonb_build_object('status', 'locked', 'keep_sharing', false);
  end if;

  select * into v_pins from private.sos_pins where user_id = v_uid;
  v_has_pin := found;

  if v_has_pin and private.pin_matches(p_pin, v_pins.duress_pin_hash) then
    update public.incidents set closed_by_citizen_at = now() where id = p_incident_id;
    insert into private.incident_duress (incident_id) values (p_incident_id)
      on conflict (incident_id) do update set at = excluded.at;
    perform private.ledger_append(
      p_action       => 'sos.duress',
      p_subject_type => 'incident',
      p_subject_id   => p_incident_id,
      p_payload      => jsonb_build_object('shown_as', 'resolved')
    );
    return jsonb_build_object('status', 'resolved', 'keep_sharing', true);
  end if;

  -- Without a PIN set up, "I'm safe" needs no PIN.
  if v_has_pin and not private.pin_matches(p_pin, v_pins.sos_pin_hash) then
    insert into private.pin_failures (user_id) values (v_uid);
    perform private.ledger_append(
      p_action       => 'sos.pin_failed',
      p_subject_type => 'incident',
      p_subject_id   => p_incident_id
    );
    return jsonb_build_object(
      'status', case when private.pin_locked(v_uid) then 'locked' else 'wrong_pin' end,
      'keep_sharing', false
    );
  end if;

  update public.incidents
     set status = 'resolved',
         resolution = p_resolution,
         resolved_at = now(),
         closed_by_citizen_at = now()
   where id = p_incident_id;
  update public.share_links
     set expires_at = now() + interval '24 hours'
   where incident_id = p_incident_id and expires_at is null;
  perform private.ledger_append(
    p_action       => 'sos.resolved',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_build_object('resolution', p_resolution)
  );
  return jsonb_build_object('status', 'resolved', 'keep_sharing', false);
end;
$$;

create function public.sos_pin_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'has_pin', exists (select 1 from private.sos_pins where user_id = auth.uid()),
    'has_duress_pin', exists (
      select 1 from private.sos_pins where user_id = auth.uid() and duress_pin_hash is not null
    )
  )
$$;

-- Sets the SOS PIN and the optional duress PIN (4 to 6 digits, different from each other).
-- Changing existing PINs needs the current SOS PIN. Returns {status: saved | wrong_pin | locked}.
create function public.set_sos_pins(
  p_sos_pin     text,
  p_duress_pin  text default null,
  p_current_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_pins private.sos_pins;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_sos_pin is null or p_sos_pin !~ '^[0-9]{4,6}$' then
    raise exception 'The SOS PIN must be 4 to 6 digits' using errcode = 'invalid_parameter_value';
  end if;
  if p_duress_pin is not null and p_duress_pin !~ '^[0-9]{4,6}$' then
    raise exception 'The duress PIN must be 4 to 6 digits' using errcode = 'invalid_parameter_value';
  end if;
  if p_duress_pin = p_sos_pin then
    raise exception 'The duress PIN must differ from the SOS PIN'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_pins from private.sos_pins where user_id = v_uid;
  if found then
    if private.pin_locked(v_uid) then
      return jsonb_build_object('status', 'locked');
    end if;
    if not private.pin_matches(p_current_pin, v_pins.sos_pin_hash) then
      insert into private.pin_failures (user_id) values (v_uid);
      return jsonb_build_object(
        'status', case when private.pin_locked(v_uid) then 'locked' else 'wrong_pin' end
      );
    end if;
  end if;

  insert into private.sos_pins (user_id, sos_pin_hash, duress_pin_hash)
  values (
    v_uid,
    extensions.crypt(p_sos_pin, extensions.gen_salt('bf', 8)),
    case when p_duress_pin is not null
      then extensions.crypt(p_duress_pin, extensions.gen_salt('bf', 8)) end
  )
  on conflict (user_id) do update
    set sos_pin_hash = excluded.sos_pin_hash,
        duress_pin_hash = excluded.duress_pin_hash,
        updated_at = now();

  perform private.ledger_append(
    p_action       => 'profile.pins_changed',
    p_subject_type => 'profile',
    p_subject_id   => v_uid
  );
  return jsonb_build_object('status', 'saved');
end;
$$;

-- The incident's ledger entries, for the citizen's timeline. A duress close is shown as a normal
-- "resolved", and what happened after it is left out, so the screen gives nothing away.
create function public.incident_timeline(p_incident_id uuid)
returns table (
  seq         bigint,
  occurred_at timestamptz,
  action      text,
  actor_role  text,
  lat         numeric,
  lng         numeric,
  payload     jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select i.id from public.incidents i where i.id = p_incident_id and i.citizen_id = auth.uid()
  ),
  duress as (
    select min(e.seq) as seq
    from public.ledger_entries e
    where e.subject_type = 'incident' and e.subject_id = p_incident_id and e.action = 'sos.duress'
  )
  select e.seq,
         e.occurred_at,
         case when e.action = 'sos.duress' then 'sos.resolved' else e.action end,
         e.actor_role,
         e.lat,
         e.lng,
         case when e.action = 'sos.duress' then jsonb_build_object('resolution', 'safe')
              else e.payload end
  from public.ledger_entries e
  where e.subject_type = 'incident'
    and e.subject_id in (select id from mine)
    and e.seq <= coalesce((select seq from duress), 9223372036854775807)
  order by e.seq
$$;

-- =============================================================================================
-- RPCs for trusted contacts (no account needed: the token is the key)
-- =============================================================================================

create function public.view_share_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_incident public.incidents;
  v_profile  public.profiles;
begin
  select * into v_link from public.share_links where token = p_token;
  if not found or (v_link.expires_at is not null and v_link.expires_at < now()) then
    return null;
  end if;

  select * into v_incident from public.incidents where id = v_link.incident_id;
  select * into v_profile from public.profiles where id = v_incident.citizen_id;

  if v_link.first_viewed_at is null then
    update public.share_links set first_viewed_at = now() where id = v_link.id;
    perform private.ledger_append(
      p_action       => 'share_link.opened',
      p_subject_type => 'incident',
      p_subject_id   => v_incident.id,
      p_payload      => jsonb_build_object('link', v_link.id)
    );
  end if;

  return jsonb_build_object(
    'citizen_name', nullif(split_part(btrim(v_profile.full_name), ' ', 1), ''),
    'citizen_phone', v_profile.phone,
    'status', v_incident.status,
    'closed_under_duress',
      exists (select 1 from private.incident_duress d where d.incident_id = v_incident.id),
    'source', v_incident.source,
    'started_at', v_incident.started_at,
    'resolved_at', v_incident.resolved_at,
    'resolution', v_incident.resolution,
    'battery_pct', v_incident.last_battery_pct,
    'last_location', case when v_incident.last_lat is null then null else jsonb_build_object(
      'lat', v_incident.last_lat,
      'lng', v_incident.last_lng,
      'accuracy_m', v_incident.last_accuracy_m,
      'at', v_incident.last_location_at
    ) end,
    'path', coalesce((
      select jsonb_agg(jsonb_build_array(p.lng, p.lat) order by p.at)
      from (
        select lp.lng, lp.lat, lp.at from public.location_pings lp
        where lp.incident_id = v_incident.id
        order by lp.at desc
        limit 300
      ) p
    ), '[]'::jsonb),
    'responders', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'at', r.created_at) order by r.created_at)
      from public.incident_responders r
      where r.incident_id = v_incident.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.respond_to_share_link(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link     public.share_links;
  v_incident public.incidents;
  v_name     text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Enter your name (up to 60 characters)' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_link from public.share_links where token = p_token;
  if not found or (v_link.expires_at is not null and v_link.expires_at < now()) then
    raise exception 'This link has expired' using errcode = 'no_data_found';
  end if;
  select * into v_incident from public.incidents where id = v_link.incident_id;
  if v_incident.status <> 'active' then
    raise exception 'This SOS has ended' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.incident_responders where incident_id = v_incident.id) >= 20 then
    raise exception 'Too many responses on this link' using errcode = 'check_violation';
  end if;

  insert into public.incident_responders (incident_id, citizen_id, share_link_id, name)
  values (v_incident.id, v_incident.citizen_id, v_link.id, v_name);

  perform private.ledger_append(
    p_action       => 'contact.responding',
    p_subject_type => 'incident',
    p_subject_id   => v_incident.id,
    p_payload      => jsonb_build_object('name', v_name)
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- =============================================================================================
-- Device API
-- =============================================================================================

-- Pairs a device and returns its HMAC secret. This is the only time the secret is shown.
create function public.register_device(p_name text, p_kind text default 'simulator')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.devices where owner_id = v_uid) >= 5 then
    raise exception 'You can pair up to 5 devices' using errcode = 'check_violation';
  end if;

  insert into public.devices (owner_id, name, kind)
  values (v_uid, btrim(p_name), p_kind)
  returning id into v_id;
  insert into private.device_secrets (device_id, secret) values (v_id, v_secret);

  perform private.ledger_append(
    p_action       => 'device.registered',
    p_subject_type => 'device',
    p_subject_id   => v_id,
    p_payload      => jsonb_build_object('kind', p_kind, 'name', btrim(p_name)),
    p_device_id    => v_id
  );
  return jsonb_build_object('device_id', v_id, 'secret', v_secret);
end;
$$;

-- Issues a new secret (for example when the virtual wearable's browser storage was cleared).
create function public.reset_device_secret(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not exists (select 1 from public.devices where id = p_device_id and owner_id = auth.uid()) then
    raise exception 'No such device' using errcode = 'no_data_found';
  end if;
  update private.device_secrets
     set secret = v_secret, rotated_at = now()
   where device_id = p_device_id;

  perform private.ledger_append(
    p_action       => 'device.secret_reset',
    p_subject_type => 'device',
    p_subject_id   => p_device_id,
    p_device_id    => p_device_id
  );
  return jsonb_build_object('device_id', p_device_id, 'secret', v_secret);
end;
$$;

-- The endpoint every wearable calls: POST /rest/v1/rpc/device_event with the publishable key.
-- p_body is the exact JSON text that was signed; p_signature is hex HMAC-SHA256(secret, p_body).
-- The body carries type, ts (Unix seconds), nonce and optional lat, lng, accuracy_m, battery_pct.
-- Requests more than 5 minutes off or reusing a nonce are rejected. See docs/05-device-protocol.md.
create function public.device_event(p_device_id uuid, p_body text, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device   public.devices;
  v_secret   text;
  v_body     jsonb;
  v_type     text;
  v_ts       timestamptz;
  v_nonce    text;
  v_lat      numeric;
  v_lng      numeric;
  v_accuracy numeric;
  v_battery  integer;
  v_extra    jsonb;
  v_event_id bigint;
  v_incident uuid;
  v_source   text;
begin
  select d.* into v_device from public.devices d where d.id = p_device_id;
  select s.secret into v_secret from private.device_secrets s where s.device_id = p_device_id;
  if v_device.id is null or v_secret is null then
    raise exception 'Unknown device' using errcode = 'invalid_authorization_specification';
  end if;
  if p_body is null or p_signature is null
     or lower(p_signature) <> encode(extensions.hmac(p_body, v_secret, 'sha256'), 'hex') then
    raise exception 'Bad signature' using errcode = 'invalid_authorization_specification';
  end if;

  begin
    v_body := p_body::jsonb;
  exception when others then
    raise exception 'Body is not valid JSON' using errcode = 'invalid_parameter_value';
  end;
  if jsonb_typeof(v_body) is distinct from 'object' then
    raise exception 'Body must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  v_type := v_body ->> 'type';
  if v_type is null
     or v_type not in ('sos', 'location', 'heartbeat', 'gesture', 'tamper', 'battery_low') then
    raise exception 'Unknown event type' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(v_body -> 'ts') is distinct from 'number' then
    raise exception 'ts must be Unix time in seconds' using errcode = 'invalid_parameter_value';
  end if;
  v_ts := to_timestamp((v_body ->> 'ts')::double precision);
  if abs(extract(epoch from now() - v_ts)) > 300 then
    raise exception 'ts is more than 5 minutes from server time'
      using errcode = 'invalid_parameter_value';
  end if;
  v_nonce := v_body ->> 'nonce';
  if v_nonce is null or v_nonce !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'nonce must be 8 to 64 letters, digits, - or _'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_body ? 'lat' or v_body ? 'lng' then
    if jsonb_typeof(v_body -> 'lat') is distinct from 'number'
       or jsonb_typeof(v_body -> 'lng') is distinct from 'number' then
      raise exception 'lat and lng must both be numbers' using errcode = 'invalid_parameter_value';
    end if;
    v_lat := round((v_body ->> 'lat')::numeric, 6);
    v_lng := round((v_body ->> 'lng')::numeric, 6);
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'lat or lng out of range' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if jsonb_typeof(v_body -> 'accuracy_m') = 'number' then
    v_accuracy := greatest((v_body ->> 'accuracy_m')::numeric, 0);
  end if;
  if jsonb_typeof(v_body -> 'battery_pct') = 'number' then
    v_battery := least(greatest(round((v_body ->> 'battery_pct')::numeric), 0), 100);
  end if;
  v_extra := v_body - array['type', 'ts', 'nonce', 'lat', 'lng', 'accuracy_m', 'battery_pct'];

  insert into public.device_events (
    device_id, owner_id, type, nonce, occurred_at, lat, lng, accuracy_m, battery_pct, payload
  ) values (
    p_device_id, v_device.owner_id, v_type, v_nonce, v_ts, v_lat, v_lng, v_accuracy, v_battery,
    v_extra
  )
  on conflict (device_id, nonce) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    raise exception 'Replayed request: nonce already used' using errcode = 'unique_violation';
  end if;

  update public.devices
     set last_seen_at = now(),
         battery_pct = coalesce(v_battery, battery_pct),
         last_lat = coalesce(v_lat, last_lat),
         last_lng = coalesce(v_lng, last_lng),
         status = case when v_type = 'tamper' then 'tamper' else status end
   where id = p_device_id;

  v_source := case v_device.kind when 'simulator' then 'simulator' else 'device' end;

  if v_type = 'sos' then
    v_incident := (private.start_incident(
      p_citizen_id  => v_device.owner_id,
      p_source      => v_source,
      p_device_id   => p_device_id,
      p_lat         => v_lat,
      p_lng         => v_lng,
      p_accuracy_m  => v_accuracy,
      p_battery_pct => v_battery,
      p_occurred_at => v_ts
    ) ->> 'incident_id')::uuid;
  elsif v_type = 'location' and v_lat is not null then
    select id into v_incident
    from public.incidents
    where citizen_id = v_device.owner_id and status = 'active';
    if v_incident is not null then
      perform private.add_ping(v_incident, v_lat, v_lng, v_accuracy, null, null, v_battery,
                               v_source);
    end if;
  elsif v_type in ('tamper', 'battery_low') then
    perform private.ledger_append(
      p_action       => 'device.' || v_type,
      p_subject_type => 'device',
      p_subject_id   => p_device_id,
      p_payload      => jsonb_strip_nulls(v_extra || jsonb_build_object('battery_pct', v_battery)),
      p_occurred_at  => v_ts,
      p_lat          => v_lat,
      p_lng          => v_lng,
      p_accuracy_m   => v_accuracy,
      p_device_id    => p_device_id,
      p_actor_id     => v_device.owner_id
    );
  end if;

  if v_incident is not null then
    update public.device_events set incident_id = v_incident where id = v_event_id;
  end if;

  return jsonb_build_object('accepted', true, 'event_id', v_event_id, 'incident_id', v_incident);
end;
$$;

-- =============================================================================================
-- Row-level security
-- =============================================================================================

alter table public.trusted_contacts enable row level security;
alter table public.devices enable row level security;
alter table public.incidents enable row level security;
alter table public.location_pings enable row level security;
alter table public.share_links enable row level security;
alter table public.incident_responders enable row level security;
alter table public.device_events enable row level security;

create policy "Owners read their contacts" on public.trusted_contacts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners add contacts" on public.trusted_contacts
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners edit their contacts" on public.trusted_contacts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners remove their contacts" on public.trusted_contacts
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Owners read their devices" on public.devices
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners edit their devices" on public.devices
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners remove their devices" on public.devices
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Citizens read their incidents" on public.incidents
  for select to authenticated using (citizen_id = (select auth.uid()));
create policy "Citizens read their location pings" on public.location_pings
  for select to authenticated using (citizen_id = (select auth.uid()));
create policy "Citizens read their live links" on public.share_links
  for select to authenticated using (citizen_id = (select auth.uid()));
create policy "Citizens read who is responding" on public.incident_responders
  for select to authenticated using (citizen_id = (select auth.uid()));
create policy "Owners read their device events" on public.device_events
  for select to authenticated using (owner_id = (select auth.uid()));

-- =============================================================================================
-- Privileges
-- =============================================================================================

revoke all on table
  public.trusted_contacts, public.devices, public.incidents, public.location_pings,
  public.share_links, public.incident_responders, public.device_events
  from public, anon, authenticated;

grant select, delete on table public.trusted_contacts to authenticated;
grant insert (name, phone, email, relationship, priority),
      update (name, phone, email, relationship, priority)
  on table public.trusted_contacts to authenticated;
grant select, delete on table public.devices to authenticated;
grant update (name, status) on table public.devices to authenticated;
grant select on table
  public.incidents, public.location_pings, public.share_links, public.incident_responders,
  public.device_events
  to authenticated;

grant all on table
  public.trusted_contacts, public.devices, public.incidents, public.location_pings,
  public.share_links, public.incident_responders, public.device_events
  to service_role;

revoke all on table
  private.device_secrets, private.sos_pins, private.pin_failures, private.incident_duress
  from public, anon, authenticated;

revoke all on function
  private.new_token(),
  private.limit_trusted_contacts(),
  private.pin_locked(uuid),
  private.pin_matches(text, text),
  private.add_ping(uuid, numeric, numeric, numeric, numeric, numeric, integer, text),
  private.start_incident(uuid, text, uuid, uuid, numeric, numeric, numeric, integer, timestamptz)
  from public, anon, authenticated;

revoke all on function
  public.create_sos(uuid, numeric, numeric, numeric, integer),
  public.record_location(uuid, numeric, numeric, numeric, numeric, numeric, integer),
  public.resolve_incident(uuid, text, text),
  public.sos_pin_status(),
  public.set_sos_pins(text, text, text),
  public.incident_timeline(uuid),
  public.register_device(text, text),
  public.reset_device_secret(uuid),
  public.view_share_link(text),
  public.respond_to_share_link(text, text),
  public.device_event(uuid, text, text)
  from public, anon;

grant execute on function
  public.create_sos(uuid, numeric, numeric, numeric, integer),
  public.record_location(uuid, numeric, numeric, numeric, numeric, numeric, integer),
  public.resolve_incident(uuid, text, text),
  public.sos_pin_status(),
  public.set_sos_pins(text, text, text),
  public.incident_timeline(uuid),
  public.register_device(text, text),
  public.reset_device_secret(uuid)
  to authenticated, service_role;

-- No account needed: live links are opened by trusted contacts, device events come from devices.
grant execute on function
  public.view_share_link(text),
  public.respond_to_share_link(text, text),
  public.device_event(uuid, text, text)
  to anon, authenticated, service_role;
