-- Phase 5, step 2: journeys and the watchdog, the job kind, demo data and privileges. See the
-- previous migration for the risk cells.

-- =============================================================================================
-- Journeys
-- =============================================================================================

create function public.start_journey(
  p_dest_lat         numeric,
  p_dest_lng         numeric,
  p_dest_name        text default null,
  p_route            jsonb default null,
  p_route_label      text default null,
  p_expected_minutes integer default null,
  p_lat              numeric default null,
  p_lng              numeric default null,
  p_client_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_journey public.journeys;
  v_route   extensions.geography;
begin
  if v_uid is null then
    raise exception 'Sign in to start a journey' using errcode = 'insufficient_privilege';
  end if;
  if p_client_id is not null then
    select * into v_journey from public.journeys where citizen_id = v_uid and client_id = p_client_id;
    if found then
      return jsonb_build_object('journey_id', v_journey.id, 'created', false);
    end if;
  end if;
  if p_dest_lat is null or p_dest_lng is null then
    raise exception 'Choose where you are going' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.journeys where citizen_id = v_uid and status = 'active') then
    raise exception 'A journey is already being watched' using errcode = 'check_violation';
  end if;
  if p_route is not null then
    if jsonb_typeof(p_route) <> 'array' or jsonb_array_length(p_route) not between 2 and 5000 then
      raise exception 'The route needs 2 to 5000 points' using errcode = 'invalid_parameter_value';
    end if;
    select extensions.st_makeline(array_agg(
             extensions.st_setsrid(extensions.st_makepoint((p ->> 0)::float8, (p ->> 1)::float8), 4326)
             order by o))::extensions.geography
      into v_route
    from jsonb_array_elements(p_route) with ordinality q(p, o);
  end if;

  insert into public.journeys (
    citizen_id, client_id, dest_lat, dest_lng, dest_name, route, route_label,
    expected_arrival_at, last_ping_at, last_lat, last_lng, moved_lat, moved_lng, last_moved_at
  ) values (
    v_uid, p_client_id, p_dest_lat, p_dest_lng, left(nullif(btrim(coalesce(p_dest_name, '')), ''), 120),
    v_route, p_route_label,
    case when p_expected_minutes between 1 and 600 then now() + make_interval(mins => p_expected_minutes) end,
    now(), p_lat, p_lng, p_lat, p_lng, now()
  )
  returning * into v_journey;

  perform private.ledger_append(
    p_action       => 'journey.started',
    p_subject_type => 'journey',
    p_subject_id   => v_journey.id,
    p_payload      => jsonb_build_object('destination', v_journey.dest_name,
                                         'route', p_route_label,
                                         'expected_minutes', p_expected_minutes),
    p_lat          => p_lat,
    p_lng          => p_lng
  );
  if p_lat is not null then
    insert into public.journey_points (journey_id, lat, lng) values (v_journey.id, p_lat, p_lng);
  end if;
  insert into private.jobs (kind, run_at, payload)
  values ('journey.check', now() + interval '15 seconds', jsonb_build_object('journey_id', v_journey.id));
  return jsonb_build_object('journey_id', v_journey.id, 'created', true);
end;
$$;

-- Pings Realtime for the citizen's journey screen.
create function private.broadcast_journey(p_journey public.journeys)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('what', 'journey', 'journey', p_journey.id), 'changed',
                        'user:' || p_journey.citizen_id::text, true);
exception when others then
  raise warning 'Live update for journey % was not sent: %', p_journey.id, sqlerrm;
end;
$$;

-- What the journey screen needs after each step.
create function private.journey_state(p_journey_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'journey_id', j.id, 'status', j.status, 'monitoring', j.monitoring,
    'interval_ms', case when j.monitoring = 'active' then 5000 else 15000 end,
    'check_in_due_at', j.check_in_due_at, 'check_in_reason', j.check_in_reason,
    'off_route_m', j.off_route_m, 'incident_id', j.incident_id,
    'escalation_reason', j.escalation_reason)
  from public.journeys j
  where j.id = p_journey_id
$$;

create function public.journey_ping(
  p_journey_id uuid,
  p_lat        numeric,
  p_lng        numeric,
  p_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := now();
  v_journey public.journeys;
  v_here    extensions.geography := private.point(p_lat, p_lng);
  v_off     numeric;
begin
  select * into v_journey from public.journeys
  where id = p_journey_id and citizen_id = auth.uid()
  for update;
  if not found then
    raise exception 'No such journey' using errcode = 'no_data_found';
  end if;
  if v_journey.status <> 'active' then
    return private.journey_state(p_journey_id);
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'A ping needs a location' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.journey_points (journey_id, lat, lng, accuracy_m, at)
  values (p_journey_id, p_lat, p_lng, p_accuracy_m, v_now);

  if v_journey.route is not null then
    v_off := round(extensions.st_distance(v_journey.route, v_here)::numeric, 1);
  end if;

  update public.journeys j
     set last_ping_at = v_now, last_lat = p_lat, last_lng = p_lng, last_accuracy_m = p_accuracy_m,
         off_route_m = v_off,
         off_route_since = case when v_off > 150 then coalesce(j.off_route_since, v_now) end,
         moved_lat = case when j.moved_lat is null
                            or extensions.st_distance(private.point(j.moved_lat, j.moved_lng), v_here) > 25
                          then p_lat else j.moved_lat end,
         moved_lng = case when j.moved_lat is null
                            or extensions.st_distance(private.point(j.moved_lat, j.moved_lng), v_here) > 25
                          then p_lng else j.moved_lng end,
         last_moved_at = case when j.moved_lat is null
                                or extensions.st_distance(private.point(j.moved_lat, j.moved_lng), v_here) > 25
                              then v_now else j.last_moved_at end
   where j.id = p_journey_id
  returning * into v_journey;

  -- Arrived: within 75 m of the destination.
  if extensions.st_dwithin(private.point(v_journey.dest_lat, v_journey.dest_lng), v_here, 75) then
    perform private.end_journey(v_journey, 'arrived', v_now);
    return private.journey_state(p_journey_id);
  end if;

  -- A high-risk cell at night switches on active monitoring (faster pings).
  if v_journey.monitoring = 'normal' and private.is_night(v_now)
     and private.cell_level(p_lat, p_lng, 'night') = 'high' then
    update public.journeys set monitoring = 'active' where id = p_journey_id;
    perform private.ledger_append(
      p_action       => 'journey.active_monitoring',
      p_subject_type => 'journey',
      p_subject_id   => p_journey_id,
      p_payload      => jsonb_build_object('reason', 'high-risk area at night'),
      p_occurred_at  => v_now,
      p_lat          => p_lat,
      p_lng          => p_lng
    );
  end if;
  return private.journey_state(p_journey_id);
end;
$$;

create function private.end_journey(p_journey public.journeys, p_status text, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.journeys
     set status = p_status, ended_at = p_now, check_in_due_at = null, check_in_reason = null
   where id = p_journey.id and status = 'active';
  if found then
    perform private.ledger_append(
      p_action       => 'journey.' || p_status,
      p_subject_type => 'journey',
      p_subject_id   => p_journey.id,
      p_payload      => jsonb_build_object('destination', p_journey.dest_name),
      p_occurred_at  => p_now,
      p_actor_id     => p_journey.citizen_id
    );
    perform private.broadcast_journey(p_journey);
  end if;
end;
$$;

create function public.end_journey(p_journey_id uuid, p_arrived boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journey public.journeys;
begin
  select * into v_journey from public.journeys
  where id = p_journey_id and citizen_id = auth.uid() for update;
  if not found then
    raise exception 'No such journey' using errcode = 'no_data_found';
  end if;
  if v_journey.check_in_due_at is not null then
    raise exception 'Answer the check-in first' using errcode = 'check_violation';
  end if;
  perform private.end_journey(v_journey, case when p_arrived then 'arrived' else 'cancelled' end, now());
  return private.journey_state(p_journey_id);
end;
$$;

-- Escalation: raise an SOS for the journey's owner at their last position.
create function private.escalate_journey(p_journey_id uuid, p_reason text, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journey public.journeys;
  v_sos     jsonb;
begin
  select * into v_journey from public.journeys where id = p_journey_id for update;
  if v_journey.status <> 'active' then
    return;
  end if;
  v_sos := private.start_incident(
    p_citizen_id => v_journey.citizen_id,
    p_source     => 'app',
    p_lat        => v_journey.last_lat,
    p_lng        => v_journey.last_lng,
    p_accuracy_m => v_journey.last_accuracy_m
  );
  update public.journeys
     set status = 'escalated', ended_at = p_now, incident_id = (v_sos ->> 'incident_id')::uuid,
         escalation_reason = p_reason, check_in_due_at = null
   where id = p_journey_id
  returning * into v_journey;
  perform private.ledger_append(
    p_action       => 'journey.escalated',
    p_subject_type => 'journey',
    p_subject_id   => p_journey_id,
    p_payload      => jsonb_build_object('reason', p_reason, 'incident', v_sos ->> 'incident_id'),
    p_occurred_at  => p_now,
    p_lat          => v_journey.last_lat,
    p_lng          => v_journey.last_lng,
    p_actor_id     => v_journey.citizen_id
  );
  perform private.ledger_append(
    p_action       => 'sos.from_journey',
    p_subject_type => 'incident',
    p_subject_id   => (v_sos ->> 'incident_id')::uuid,
    p_payload      => jsonb_build_object('journey', p_journey_id, 'reason', p_reason),
    p_occurred_at  => p_now,
    p_actor_id     => v_journey.citizen_id
  );
  perform private.broadcast_journey(v_journey);
end;
$$;

-- "Are you OK?": 60 seconds to answer.
create function private.request_check_in(p_journey public.journeys, p_reason text, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.journeys
     set check_in_due_at = p_now + interval '60 seconds', check_in_reason = p_reason
   where id = p_journey.id;
  perform private.ledger_append(
    p_action       => 'journey.check_in_requested',
    p_subject_type => 'journey',
    p_subject_id   => p_journey.id,
    p_payload      => jsonb_build_object('reason', p_reason, 'off_route_m', p_journey.off_route_m),
    p_occurred_at  => p_now,
    p_lat          => p_journey.last_lat,
    p_lng          => p_journey.last_lng,
    p_actor_id     => p_journey.citizen_id
  );
  perform private.broadcast_journey(p_journey);
end;
$$;

-- The watchdog, every 15 s (5 s under active monitoring) while the journey is active.
create function private.check_journey(p_journey_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journey public.journeys;
  v_here    extensions.geography;
begin
  select * into v_journey from public.journeys where id = p_journey_id;
  if v_journey.id is null or v_journey.status <> 'active' then
    return;
  end if;
  v_here := case when v_journey.last_lat is not null
                 then private.point(v_journey.last_lat, v_journey.last_lng) end;

  if v_journey.check_in_due_at is not null and p_now >= v_journey.check_in_due_at then
    perform private.escalate_journey(p_journey_id, 'no_check_in', p_now);
    return;
  elsif v_journey.last_ping_at < p_now - interval '45 seconds' then
    -- Silence is the alarm: the phone may be dead or taken, so no check-in first.
    perform private.escalate_journey(p_journey_id, 'lost_heartbeat', p_now);
    return;
  elsif v_journey.check_in_due_at is null then
    if v_journey.off_route_since is not null
       and v_journey.off_route_since <= p_now - interval '60 seconds' then
      perform private.request_check_in(v_journey, 'off_route', p_now);
    elsif v_here is not null and v_journey.last_moved_at <= p_now - interval '3 minutes'
       and not extensions.st_dwithin(private.point(v_journey.dest_lat, v_journey.dest_lng), v_here, 150)
       and not exists (select 1 from public.safe_points sp
                       where abs(sp.lat - v_journey.last_lat) < 0.002
                         and abs(sp.lng - v_journey.last_lng) < 0.002
                         and extensions.st_dwithin(private.point(sp.lat, sp.lng), v_here, 100)) then
      perform private.request_check_in(v_journey, 'stopped', p_now);
    end if;
  end if;

  insert into private.jobs (kind, run_at, payload)
  values ('journey.check',
          p_now + case when v_journey.monitoring = 'active' then interval '5 seconds'
                       else interval '15 seconds' end,
          jsonb_build_object('journey_id', p_journey_id));
end;
$$;

-- The answer to "Are you OK?". The duress PIN looks like a normal answer on screen but raises
-- the SOS. Without PINs set up, "I'm OK" needs no PIN.
create function public.journey_check_in(p_journey_id uuid, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_journey public.journeys;
  v_pins    private.sos_pins;
  v_has_pin boolean;
begin
  select * into v_journey from public.journeys
  where id = p_journey_id and citizen_id = v_uid for update;
  if not found then
    raise exception 'No such journey' using errcode = 'no_data_found';
  end if;
  if v_journey.status <> 'active' or v_journey.check_in_due_at is null then
    return jsonb_build_object('ok', true) || private.journey_state(p_journey_id);
  end if;
  if private.pin_locked(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  select * into v_pins from private.sos_pins where user_id = v_uid;
  v_has_pin := found;

  if v_has_pin and private.pin_matches(p_pin, v_pins.duress_pin_hash) then
    perform private.escalate_journey(p_journey_id, 'duress_pin', now());
    -- Looks like a normal "you're OK" to anyone watching the screen.
    return jsonb_build_object('ok', true, 'journey_id', p_journey_id, 'status', 'active',
                              'interval_ms', 15000);
  end if;
  if v_has_pin and not private.pin_matches(p_pin, v_pins.sos_pin_hash) then
    insert into private.pin_failures (user_id) values (v_uid);
    return jsonb_build_object('ok', false,
                              'error', case when private.pin_locked(v_uid) then 'locked' else 'wrong_pin' end);
  end if;

  update public.journeys
     set check_in_due_at = null, check_in_reason = null, off_route_since = null,
         last_moved_at = now(), moved_lat = last_lat, moved_lng = last_lng
   where id = p_journey_id;
  perform private.ledger_append(
    p_action       => 'journey.checked_in',
    p_subject_type => 'journey',
    p_subject_id   => p_journey_id,
    p_payload      => jsonb_build_object('reason', v_journey.check_in_reason)
  );
  return jsonb_build_object('ok', true) || private.journey_state(p_journey_id);
end;
$$;

-- The journey screen: the journey, its route and the path so far.
create function public.journey_view(p_journey_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(j) - 'route' - 'client_id' - 'citizen_id' || jsonb_build_object(
    'route', case when j.route is null then null
                  else (extensions.st_asgeojson(j.route)::jsonb -> 'coordinates') end,
    'interval_ms', case when j.monitoring = 'active' then 5000 else 15000 end,
    'path', coalesce((select jsonb_agg(jsonb_build_array(p.lng, p.lat) order by p.at)
                      from (select * from public.journey_points
                            where journey_id = j.id order by at desc limit 500) p), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
                                   'seq', e.seq, 'occurred_at', e.occurred_at, 'action', e.action,
                                   'payload', e.payload) order by e.seq)
                          from public.ledger_entries e
                          where e.subject_type = 'journey' and e.subject_id = j.id), '[]'::jsonb))
  from public.journeys j
  where j.id = p_journey_id and j.citizen_id = auth.uid()
$$;

-- =============================================================================================
-- Jobs, demo data and privileges
-- =============================================================================================

create or replace function private.run_job(p_kind text, p_payload jsonb, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  case p_kind
    when 'sos.reminder' then
      perform private.remind_contacts((p_payload ->> 'incident_id')::uuid, p_now);
    when 'incident.escalate' then
      perform private.escalate_incident((p_payload ->> 'incident_id')::uuid,
                                        (p_payload ->> 'level')::integer, p_now);
    when 'complaint.escalate' then
      perform private.escalate_complaint((p_payload ->> 'complaint_id')::uuid,
                                         (p_payload ->> 'level')::integer, p_now);
    when 'complaint.triage_check' then
      perform private.check_triage((p_payload ->> 'complaint_id')::uuid,
                                   (p_payload ->> 'try')::integer, p_now);
    when 'evidence.check' then
      perform private.check_evidence((p_payload ->> 'check_id')::uuid,
                                     (p_payload ->> 'try')::integer, p_now);
    when 'evidence.expire_upload' then
      perform private.expire_upload((p_payload ->> 'evidence_id')::uuid, p_now);
    when 'evidence.purge' then
      perform private.purge_evidence((p_payload ->> 'evidence_id')::uuid, p_now);
    when 'journey.check' then
      perform private.check_journey((p_payload ->> 'journey_id')::uuid, p_now);
    else
      raise exception 'Unknown job kind %', p_kind;
  end case;
end;
$$;

-- The demo red zone: a dark, isolated stretch of Janpath (two cells), reported repeatedly at
-- night, on the virtual wearable's demo walk. Plus a medium cell near Mandi House.
insert into public.zone_reports (kind, lat, lng, at_night, is_demo, note)
select k.kind, k.lat, k.lng, k.at_night, true, 'Demo data'
from (values
  ('poor_lighting', 28.6240, 77.2188, true), ('isolated', 28.6245, 77.2186, true),
  ('harassment', 28.6250, 77.2188, true), ('poor_lighting', 28.6255, 77.2187, true),
  ('isolated', 28.6238, 77.2189, true), ('harassment', 28.6252, 77.2190, false),
  ('harassment', 28.6243, 77.2187, true), ('isolated', 28.6248, 77.2189, true),
  ('poor_lighting', 28.6270, 77.2191, true), ('isolated', 28.6275, 77.2193, true),
  ('harassment', 28.6280, 77.2192, true), ('poor_lighting', 28.6265, 77.2190, true),
  ('isolated', 28.6283, 77.2194, true), ('harassment', 28.6278, 77.2193, false),
  ('harassment', 28.6268, 77.2191, true), ('isolated', 28.6273, 77.2192, true),
  ('poor_lighting', 28.6262, 77.2345, true), ('isolated', 28.6258, 77.2342, true),
  ('unsafe_crowd', 28.6255, 77.2340, false)
) k(kind, lat, lng, at_night);

do $$
begin
  perform private.compute_risk_cells(now());
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('risk-cells', '7 * * * *', 'select private.compute_risk_cells()');
  end if;
end
$$;

revoke all on function
  private.cell_deg(),
  private.risk_min_signals(),
  private.is_night(timestamptz),
  private.point(numeric, numeric),
  private.compute_risk_cells(timestamptz),
  private.cell_level(numeric, numeric, text),
  private.broadcast_journey(public.journeys),
  private.journey_state(uuid),
  private.end_journey(public.journeys, text, timestamptz),
  private.escalate_journey(uuid, text, timestamptz),
  private.request_check_in(public.journeys, text, timestamptz),
  private.check_journey(uuid, timestamptz)
  from public, anon, authenticated;

revoke all on function
  public.risk_map(text),
  public.report_zone(numeric, numeric, text, boolean, text),
  public.score_routes(jsonb, timestamptz),
  public.start_journey(numeric, numeric, text, jsonb, text, integer, numeric, numeric, uuid),
  public.journey_ping(uuid, numeric, numeric, numeric),
  public.end_journey(uuid, boolean),
  public.journey_check_in(uuid, text),
  public.journey_view(uuid)
  from public, anon;
grant execute on function
  public.risk_map(text),
  public.report_zone(numeric, numeric, text, boolean, text),
  public.score_routes(jsonb, timestamptz),
  public.start_journey(numeric, numeric, text, jsonb, text, integer, numeric, numeric, uuid),
  public.journey_ping(uuid, numeric, numeric, numeric),
  public.end_journey(uuid, boolean),
  public.journey_check_in(uuid, text),
  public.journey_view(uuid)
  to authenticated, service_role;
