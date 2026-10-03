-- Phase 2, step 3: the authority console's reads and actions, and what the citizen and her
-- contacts see of the response.
--
-- Staff never read citizens' rows directly: these RPCs check private.can_see_incident() and
-- return only what the board needs. Every action is a ledger entry.

-- =============================================================================================
-- Reads
-- =============================================================================================

-- One incident as the board shows it.
create function private.board_row(p_incident public.incidents)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_incident.id,
    'status', p_incident.status,
    'source', p_incident.source,
    'is_demo', p_incident.is_demo,
    'started_at', p_incident.started_at,
    'citizen_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed citizen'),
    'citizen_phone', p.phone,
    'battery_pct', p_incident.last_battery_pct,
    'last_location', case when p_incident.last_lat is null then null else jsonb_build_object(
      'lat', p_incident.last_lat, 'lng', p_incident.last_lng,
      'accuracy_m', p_incident.last_accuracy_m, 'at', p_incident.last_location_at) end,
    'org_id', p_incident.assigned_org_id,
    'org_name', o.name,
    'response_state', p_incident.response_state,
    'escalation_level', p_incident.escalation_level,
    'escalated_at', p_incident.escalated_at,
    'acknowledged_at', p_incident.acknowledged_at,
    'acknowledged_by', ap.full_name,
    'unit', case when u.id is null then null
                 else jsonb_build_object('id', u.id, 'call_sign', u.call_sign) end,
    'dispatched_at', p_incident.dispatched_at,
    'eta_at', p_incident.eta_at,
    'arrived_at', p_incident.arrived_at,
    'closed_under_duress',
      exists (select 1 from private.incident_duress d where d.incident_id = p_incident.id),
    'responders', (select count(*) from public.incident_responders r
                   where r.incident_id = p_incident.id),
    'close_code', p_incident.close_code
  )
  from public.profiles p
  left join public.organizations o on o.id = p_incident.assigned_org_id
  left join public.profiles ap on ap.id = p_incident.acknowledged_by
  left join public.patrol_units u on u.id = p_incident.unit_id
  where p.id = p_incident.citizen_id
$$;

-- Active incidents the caller may see, most urgent first: highest escalation, then not yet
-- acknowledged, then oldest.
create function public.console_board()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.board_row(i)
                            order by i.escalation_level desc, (i.acknowledged_at is null) desc,
                                     i.started_at), '[]'::jsonb)
  from public.incidents i
  where i.status = 'active' and private.can_see_incident(i.id)
$$;

-- Everything the incident command view needs.
create function public.console_incident(p_incident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found or not private.can_see_incident(p_incident_id) then
    raise exception 'No such incident' using errcode = 'no_data_found';
  end if;

  return private.board_row(v_incident) || jsonb_build_object(
    'resolved_at', v_incident.resolved_at,
    'close_note', v_incident.close_note,
    'metrics', jsonb_build_object(
      'ack_s', round(extract(epoch from v_incident.acknowledged_at - v_incident.started_at)),
      'dispatch_s', round(extract(epoch from v_incident.dispatched_at - v_incident.started_at)),
      'arrival_s', round(extract(epoch from v_incident.arrived_at - v_incident.started_at))),
    'path', coalesce((
      select jsonb_agg(jsonb_build_array(p.lng, p.lat) order by p.at)
      from (select lp.lng, lp.lat, lp.at from public.location_pings lp
            where lp.incident_id = p_incident_id order by lp.at desc limit 500) p
    ), '[]'::jsonb),
    'responders', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'at', r.created_at) order by r.created_at)
      from public.incident_responders r where r.incident_id = p_incident_id
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'call_sign', u.call_sign, 'kind', u.kind, 'status', u.status,
               'org_name', o.name,
               'distance_m', case when v_incident.last_lat is null or u.last_lat is null then null
                 else round(extensions.st_distance(
                   extensions.st_setsrid(extensions.st_makepoint(u.last_lng::float8, u.last_lat::float8), 4326)::extensions.geography,
                   extensions.st_setsrid(extensions.st_makepoint(v_incident.last_lng::float8, v_incident.last_lat::float8), 4326)::extensions.geography))
                 end)
             order by (u.status = 'available') desc, u.call_sign)
      from public.patrol_units u
      join public.organizations o on o.id = u.org_id
      where u.org_id = v_incident.assigned_org_id
         or u.org_id in (select private.org_ancestors(v_incident.assigned_org_id))
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', e.seq, 'occurred_at', e.occurred_at, 'action', e.action,
               'actor_role', e.actor_role, 'payload', e.payload) order by e.seq)
      from public.ledger_entries e
      where e.subject_type = 'incident' and e.subject_id = p_incident_id
    ), '[]'::jsonb)
  );
end;
$$;

-- =============================================================================================
-- Actions
-- =============================================================================================

-- Locks the incident for an action, after checking the caller may act on it.
create function private.incident_for_action(p_incident_id uuid)
returns public.incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
begin
  if not private.can_see_incident(p_incident_id) then
    raise exception 'No such incident' using errcode = 'no_data_found';
  end if;
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if v_incident.status <> 'active' then
    raise exception 'This incident is closed' using errcode = 'check_violation';
  end if;
  return v_incident;
end;
$$;

-- One click. The first acknowledgement stops the escalation ladder.
create function public.acknowledge_incident(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents := private.incident_for_action(p_incident_id);
begin
  if v_incident.acknowledged_at is null then
    update public.incidents
       set acknowledged_at = now(),
           acknowledged_by = auth.uid(),
           response_state = case when response_state = 'unacknowledged'
                                 then 'acknowledged' else response_state end
     where id = p_incident_id;
    perform private.ledger_append(
      p_action       => 'incident.acknowledged',
      p_subject_type => 'incident',
      p_subject_id   => p_incident_id,
      p_payload      => jsonb_build_object(
                          'after_s', round(extract(epoch from now() - v_incident.started_at)),
                          'level', v_incident.escalation_level)
    );
  end if;
  return jsonb_build_object('acknowledged', true);
end;
$$;

-- Sends a patrol unit with an ETA. Dispatching also acknowledges.
create function public.dispatch_unit(p_incident_id uuid, p_unit_id uuid, p_eta_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_unit     public.patrol_units;
begin
  if p_eta_minutes is null or p_eta_minutes not between 1 and 120 then
    raise exception 'ETA must be 1 to 120 minutes' using errcode = 'invalid_parameter_value';
  end if;
  v_incident := private.incident_for_action(p_incident_id);
  perform public.acknowledge_incident(p_incident_id);

  select * into v_unit from public.patrol_units where id = p_unit_id for update;
  if not found or not (v_unit.org_id = v_incident.assigned_org_id
                       or v_unit.org_id in (select private.org_ancestors(v_incident.assigned_org_id))) then
    raise exception 'That unit does not belong to this station' using errcode = 'invalid_parameter_value';
  end if;
  if v_unit.status <> 'available' and v_unit.id is distinct from v_incident.unit_id then
    raise exception '% is not available', v_unit.call_sign using errcode = 'check_violation';
  end if;

  -- A unit swapped out goes back on the road.
  update public.patrol_units set status = 'available'
   where id = v_incident.unit_id and id <> p_unit_id;
  update public.patrol_units set status = 'dispatched' where id = p_unit_id;
  update public.incidents
     set unit_id = p_unit_id,
         dispatched_at = coalesce(dispatched_at, now()),
         eta_at = now() + make_interval(mins => p_eta_minutes),
         arrived_at = null,
         response_state = 'responding'
   where id = p_incident_id;

  perform private.ledger_append(
    p_action       => 'incident.dispatched',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_build_object('unit', v_unit.call_sign, 'eta_min', p_eta_minutes)
  );
  return jsonb_build_object('dispatched', true);
end;
$$;

create function public.mark_on_scene(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents := private.incident_for_action(p_incident_id);
  v_unit     text;
begin
  if v_incident.unit_id is null then
    raise exception 'Dispatch a unit first' using errcode = 'check_violation';
  end if;
  update public.patrol_units set status = 'on_scene' where id = v_incident.unit_id
  returning call_sign into v_unit;
  update public.incidents
     set arrived_at = now(), response_state = 'on_scene'
   where id = p_incident_id;
  perform private.ledger_append(
    p_action       => 'incident.on_scene',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_build_object(
                        'unit', v_unit,
                        'after_s', round(extract(epoch from now() - v_incident.started_at)))
  );
  return jsonb_build_object('on_scene', true);
end;
$$;

-- Closing always needs a code. The note goes into the ledger with it.
create function public.close_incident(p_incident_id uuid, p_code text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_code is null or p_code not in
     ('user_safe', 'assisted_on_scene', 'transferred_to_case', 'false_alarm', 'duplicate') then
    raise exception 'Pick a closing code' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'The note can be up to 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  v_incident := private.incident_for_action(p_incident_id);

  update public.patrol_units set status = 'available' where id = v_incident.unit_id;
  update public.incidents
     set status = 'resolved',
         resolved_at = now(),
         close_code = p_code,
         close_note = v_note,
         closed_by = auth.uid(),
         acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_incident_id;
  update public.alerts set status = 'cancelled'
   where incident_id = p_incident_id and status = 'queued';
  update public.share_links set expires_at = now() + interval '24 hours'
   where incident_id = p_incident_id and expires_at is null;

  perform private.ledger_append(
    p_action       => 'incident.closed',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_strip_nulls(jsonb_build_object('code', p_code, 'note', v_note))
  );
  return jsonb_build_object('closed', true);
end;
$$;

-- The on-duty toggle in the console header.
create function public.set_on_duty(p_org_id uuid, p_on_duty boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.memberships
     set on_duty = p_on_duty
   where user_id = auth.uid() and org_id = p_org_id;
  if not found then
    raise exception 'You are not a member of that organisation' using errcode = 'no_data_found';
  end if;
  perform private.ledger_append(
    p_action       => 'staff.duty_changed',
    p_subject_type => 'organization',
    p_subject_id   => p_org_id,
    p_payload      => jsonb_build_object('on_duty', p_on_duty)
  );
end;
$$;

-- Admins edit the ladder: up to five levels, each later than the last.
create function public.admin_set_escalation_policy(
  p_org_id   uuid,
  p_levels   jsonb,
  p_repeat_s integer
)
returns public.escalation_policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level  jsonb;
  v_prev   integer := 0;
  v_after  integer;
  v_policy public.escalation_policies;
begin
  if not private.has_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can change escalation policies'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_levels) is distinct from 'array'
     or jsonb_array_length(p_levels) not between 1 and 5 then
    raise exception 'A policy has 1 to 5 levels' using errcode = 'invalid_parameter_value';
  end if;
  for v_level in select * from jsonb_array_elements(p_levels) loop
    if jsonb_typeof(v_level -> 'after_s') is distinct from 'number'
       or v_level ->> 'to' is null or v_level ->> 'to' not in ('station', 'parent') then
      raise exception 'Each level needs after_s and to (station or parent)'
        using errcode = 'invalid_parameter_value';
    end if;
    v_after := (v_level ->> 'after_s')::integer;
    if v_after < 30 or v_after > 3600 or v_after <= v_prev then
      raise exception 'Levels must come between 30 s and 1 h, each later than the last'
        using errcode = 'invalid_parameter_value';
    end if;
    v_prev := v_after;
  end loop;

  if p_org_id is null then
    update public.escalation_policies
       set levels = p_levels, repeat_s = p_repeat_s, updated_at = now(), updated_by = auth.uid()
     where org_id is null
    returning * into v_policy;
  else
    insert into public.escalation_policies (org_id, levels, repeat_s, updated_by)
    values (p_org_id, p_levels, p_repeat_s, auth.uid())
    on conflict (org_id) do update
      set levels = excluded.levels, repeat_s = excluded.repeat_s,
          updated_at = now(), updated_by = excluded.updated_by
    returning * into v_policy;
  end if;

  perform private.ledger_append(
    p_action       => 'policy.escalation_changed',
    p_subject_type => 'organization',
    p_subject_id   => p_org_id,
    p_payload      => jsonb_build_object('levels', p_levels, 'repeat_s', p_repeat_s)
  );
  return v_policy;
end;
$$;

-- =============================================================================================
-- What the citizen and her contacts see of the response
-- =============================================================================================

create function private.response_view(p_incident public.incidents)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'org_phone', o.phone,
    'state', p_incident.response_state,
    'acknowledged_at', p_incident.acknowledged_at,
    'unit', u.call_sign,
    'eta_at', p_incident.eta_at,
    'arrived_at', p_incident.arrived_at,
    'raised_to_control_room', p_incident.escalation_level >= 2
  )
  from (select 1) one
  left join public.organizations o on o.id = p_incident.assigned_org_id
  left join public.patrol_units u on u.id = p_incident.unit_id
$$;

create function public.incident_response(p_incident_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.response_view(i)
  from public.incidents i
  where i.id = p_incident_id and i.citizen_id = auth.uid()
$$;

-- The live link, plus the police response.
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
    'police', private.response_view(v_incident),
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

-- =============================================================================================
-- Row-level security and privileges
-- =============================================================================================

-- The unit policy walks the organisation tree as the signed-in user; the tree isn't secret.
grant execute on function private.org_ancestors(uuid) to authenticated;

alter table public.patrol_units enable row level security;
alter table public.escalation_policies enable row level security;
alter table public.incident_escalations enable row level security;

create policy "Staff read their organisations' units" on public.patrol_units
  for select to authenticated
  using (
    (select private.has_role(array['admin', 'oversight']::public.app_role[]))
    or exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and (m.org_id = patrol_units.org_id
             or patrol_units.org_id in (select private.org_ancestors(m.org_id))
             or m.org_id in (select private.org_ancestors(patrol_units.org_id)))
    )
  );

create policy "Staff read escalation policies" on public.escalation_policies
  for select to authenticated
  using ((select private.has_role(
    array['officer', 'supervisor', 'oversight', 'admin']::public.app_role[])));

create policy "Staff read escalations of incidents they see" on public.incident_escalations
  for select to authenticated
  using (private.can_see_incident(incident_id));

revoke all on table public.patrol_units, public.escalation_policies, public.incident_escalations
  from public, anon, authenticated;
grant select on table public.patrol_units, public.escalation_policies, public.incident_escalations
  to authenticated;
grant all on table public.patrol_units, public.escalation_policies, public.incident_escalations
  to service_role;

revoke all on function
  private.board_row(public.incidents),
  private.incident_for_action(uuid),
  private.response_view(public.incidents)
  from public, anon, authenticated;

revoke all on function
  public.console_board(),
  public.console_incident(uuid),
  public.acknowledge_incident(uuid),
  public.dispatch_unit(uuid, uuid, integer),
  public.mark_on_scene(uuid),
  public.close_incident(uuid, text, text),
  public.set_on_duty(uuid, boolean),
  public.admin_set_escalation_policy(uuid, jsonb, integer),
  public.incident_response(uuid)
  from public, anon;

grant execute on function
  public.console_board(),
  public.console_incident(uuid),
  public.acknowledge_incident(uuid),
  public.dispatch_unit(uuid, uuid, integer),
  public.mark_on_scene(uuid),
  public.close_incident(uuid, text, text),
  public.set_on_duty(uuid, boolean),
  public.admin_set_escalation_policy(uuid, jsonb, integer),
  public.incident_response(uuid)
  to authenticated, service_role;
