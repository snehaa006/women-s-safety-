-- Phase 1 part B, step 5: the SOS functions queue alerts, honour queued trigger times, tell
-- contacts when she is safe, and give live links a Realtime topic.

-- =============================================================================================
-- SOS: queue alerts at the start, schedule the reminder, honour the original trigger time
-- =============================================================================================

create or replace function private.start_incident(
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
  v_alerts   integer;
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
      where incident_id = v_incident.id and audience = 'shared';
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
    where incident_id = v_incident.id and audience = 'shared';
    return jsonb_build_object('incident_id', v_incident.id, 'share_token', v_token,
                              'created', false);
  end if;

  insert into public.incidents (citizen_id, source, client_id, device_id, started_at)
  values (p_citizen_id, p_source, p_client_id, p_device_id, coalesce(p_occurred_at, now()))
  returning * into v_incident;

  insert into public.share_links (incident_id, citizen_id)
  values (v_incident.id, p_citizen_id)
  returning token into v_token;

  -- A queued (offline) SOS keeps its trigger time; the ledger also records when it arrived.
  perform private.ledger_append(
    p_action       => 'sos.triggered',
    p_subject_type => 'incident',
    p_subject_id   => v_incident.id,
    p_payload      => jsonb_strip_nulls(jsonb_build_object(
                        'source', p_source, 'battery_pct', p_battery_pct,
                        'delayed_s', case when p_occurred_at < now() - interval '30 seconds'
                                          then round(extract(epoch from now() - p_occurred_at))
                                     end)),
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

  -- Alert the circle (L0) and check back in 2 minutes.
  v_alerts := private.queue_alerts(v_incident.id, 'sos', 0::smallint);
  if v_alerts > 0 then
    perform private.ledger_append(
      p_action       => 'alerts.queued',
      p_subject_type => 'incident',
      p_subject_id   => v_incident.id,
      p_payload      => jsonb_build_object('alerts', v_alerts, 'level', 0),
      p_actor_id     => p_citizen_id
    );
    perform private.request_notify();
  end if;
  insert into private.jobs (kind, run_at, payload)
  values ('sos.reminder', now() + interval '2 minutes',
          jsonb_build_object('incident_id', v_incident.id));

  return jsonb_build_object('incident_id', v_incident.id, 'share_token', v_token,
                            'created', true);
end;
$$;

-- p_occurred_at is set by the app's offline queue: when the SOS was really triggered. The
-- five-argument version is moved out of the API (into private, renamed) rather than removed.
alter function public.create_sos(uuid, numeric, numeric, numeric, integer) rename to create_sos_v1;
alter function public.create_sos_v1(uuid, numeric, numeric, numeric, integer) set schema private;
revoke all on function private.create_sos_v1(uuid, numeric, numeric, numeric, integer)
  from public, anon, authenticated;

create function public.create_sos(
  p_client_id   uuid default null,
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
begin
  if auth.uid() is null then
    raise exception 'Sign in to send an SOS' using errcode = 'insufficient_privilege';
  end if;
  if p_occurred_at > now() + interval '2 minutes' then
    raise exception 'The SOS time is in the future; check the phone clock'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_occurred_at < now() - interval '24 hours' then
    raise exception 'This queued SOS is more than a day old' using errcode = 'invalid_parameter_value';
  end if;
  return private.start_incident(
    p_citizen_id  => auth.uid(),
    p_source      => 'app',
    p_client_id   => p_client_id,
    p_lat         => p_lat,
    p_lng         => p_lng,
    p_accuracy_m  => p_accuracy_m,
    p_battery_pct => p_battery_pct,
    p_occurred_at => case when p_occurred_at is not null then least(p_occurred_at, now()) end
  );
end;
$$;

comment on function public.create_sos is
  'Start an SOS (or return the active one). Returns {incident_id, share_token, created}.';

-- "I'm safe": as before, plus queued alerts are cancelled and contacts who got the SOS are told.
-- The duress PIN changes nothing for the contacts: alerts and reminders carry on.
create or replace function public.resolve_incident(
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
  perform private.ledger_append(
    p_action       => 'sos.resolved',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_build_object('resolution', p_resolution)
  );

  update public.alerts
     set status = 'cancelled'
   where incident_id = p_incident_id and status = 'queued';
  if private.queue_alerts(p_incident_id, 'safe', 0::smallint) > 0 then
    perform private.request_notify();
  end if;
  update public.share_links
     set expires_at = now() + interval '24 hours'
   where incident_id = p_incident_id and expires_at is null;
  return jsonb_build_object('status', 'resolved', 'keep_sharing', false);
end;
$$;

-- =============================================================================================
-- Live link: per-contact links, the Realtime topic, and acknowledgements
-- =============================================================================================

create or replace function public.view_share_link(p_token text)
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
      p_payload      => jsonb_strip_nulls(jsonb_build_object(
                          'link', v_link.id, 'name', v_link.recipient_name))
    );
  end if;

  return jsonb_build_object(
    'citizen_name', nullif(split_part(btrim(v_profile.full_name), ' ', 1), ''),
    'citizen_phone', v_profile.phone,
    'contact_name', v_link.recipient_name,
    'channel', 'live:' || v_incident.live_topic,
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

create or replace function public.respond_to_share_link(p_token text, p_name text)
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
  update public.alerts
     set acked_at = now()
   where share_link_id = v_link.id and acked_at is null;

  perform private.ledger_append(
    p_action       => 'contact.responding',
    p_subject_type => 'incident',
    p_subject_id   => v_incident.id,
    p_payload      => jsonb_build_object('name', v_name)
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- create_sos was recreated with a new signature, so its privileges are set again.
revoke all on function public.create_sos(uuid, numeric, numeric, numeric, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_sos(uuid, numeric, numeric, numeric, integer, timestamptz)
  to authenticated, service_role;
