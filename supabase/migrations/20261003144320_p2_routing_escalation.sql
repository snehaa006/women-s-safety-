-- Phase 2, step 2: routing incidents to a station and climbing the escalation ladder.
--
-- Routing: a new incident first belongs to the district control room, so someone always sees
-- it. The first location fix routes it to the station whose jurisdiction contains the point,
-- or else the nearest station within 50 km (docs/03-workflows.md §1).
-- Escalation: an `incident.escalate` job per level, run by private.tick(). Any officer
-- acknowledgement stops it (the job finds acknowledged_at set and does nothing).

-- =============================================================================================
-- Organisation helpers
-- =============================================================================================

-- Parents, grandparents, ... of an organisation (not itself).
create function private.org_ancestors(p_org_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select o.parent_id as id, 1 as depth from public.organizations o where o.id = p_org_id
    union all
    select o.parent_id, up.depth + 1 from public.organizations o join up on o.id = up.id
    where up.depth < 10
  )
  select id from up where id is not null
$$;

-- Where an incident goes before it has a location: the first active control room.
create function private.default_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.organizations o
  where o.is_active and o.type = 'control_room'
  order by o.created_at, o.id
  limit 1
$$;

-- The station for a point: by jurisdiction, else the nearest within 50 km.
create function private.route_point(p_lat numeric, p_lng numeric)
returns table (org_id uuid, how text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_point extensions.geography :=
    extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326)::extensions.geography;
begin
  return query
  select o.id, 'jurisdiction'::text
  from public.organizations o
  where o.is_active and o.type = 'police_station' and o.jurisdiction is not null
    and extensions.st_covers(o.jurisdiction, v_point)
  order by extensions.st_area(o.jurisdiction)
  limit 1;
  if found then
    return;
  end if;

  return query
  select o.id, 'nearest'::text
  from public.organizations o
  where o.is_active and o.type = 'police_station' and o.location is not null
    and extensions.st_dwithin(o.location, v_point, 50000)
  order by extensions.st_distance(o.location, v_point)
  limit 1;
end;
$$;

-- The policy that applies to an organisation: its own, else the nearest ancestor's, else the
-- default.
create function private.policy_for(p_org_id uuid)
returns public.escalation_policies
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.escalation_policies p
  where p.org_id = p_org_id
     or p.org_id in (select private.org_ancestors(p_org_id))
     or p.org_id is null
  order by case when p.org_id = p_org_id then 0 when p.org_id is null then 2 else 1 end
  limit 1
$$;

-- =============================================================================================
-- Who on the authority side may see an incident
-- =============================================================================================

-- Admin and oversight see everything. Members of the handling station see it. Members of a
-- parent organisation see it once it has escalated to them (level 2), and their supervisors
-- always do.
create function private.can_see_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['admin', 'oversight']::public.app_role[])
    or exists (
      select 1
      from public.incidents i
      join public.memberships m on m.user_id = auth.uid()
      where i.id = p_incident_id
        and private.has_role(array['officer', 'supervisor']::public.app_role[])
        and (
          m.org_id = i.assigned_org_id
          or (m.org_id in (select private.org_ancestors(i.assigned_org_id))
              and (i.escalation_level >= 2 or m.role = 'supervisor'))
        )
    )
$$;

-- =============================================================================================
-- Routing triggers
-- =============================================================================================

create function private.on_incident_insert_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.assigned_org_id := coalesce(new.assigned_org_id, private.default_org());
  return new;
end;
$$;

create trigger incidents_route_insert
  before insert on public.incidents
  for each row execute function private.on_incident_insert_route();

-- The first location fix decides the station, unless an officer already took the incident.
create function private.on_incident_first_fix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_how  text;
  v_name text;
begin
  select r.org_id, r.how into v_org, v_how from private.route_point(new.last_lat, new.last_lng) r;
  new.routed_at := now();
  if v_org is null or v_org = new.assigned_org_id then
    return new;
  end if;
  new.assigned_org_id := v_org;
  select name into v_name from public.organizations where id = v_org;
  -- The first escalation check was timed by the control room's policy; use the station's.
  if new.escalation_level = 0 then
    update private.jobs
       set run_at = new.started_at + make_interval(
             secs => ((private.policy_for(v_org)).levels -> 0 ->> 'after_s')::integer)
     where kind = 'incident.escalate' and status = 'pending'
       and payload ->> 'incident_id' = new.id::text and payload ->> 'level' = '1';
  end if;
  perform private.ledger_append(
    p_action       => 'incident.routed',
    p_subject_type => 'incident',
    p_subject_id   => new.id,
    p_payload      => jsonb_build_object('org', v_org, 'name', v_name, 'how', v_how)
  );
  return new;
end;
$$;

create trigger incidents_route_first_fix
  before update of last_lat, last_lng on public.incidents
  for each row
  when (old.routed_at is null and new.last_lat is not null and new.acknowledged_at is null)
  execute function private.on_incident_first_fix();

-- Schedules the first escalation check, timed from when the SOS really started.
create function private.on_incident_insert_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.escalation_policies := private.policy_for(new.assigned_org_id);
begin
  insert into private.jobs (kind, run_at, payload)
  values ('incident.escalate',
          new.started_at + make_interval(secs => (v_policy.levels -> 0 ->> 'after_s')::integer),
          jsonb_build_object('incident_id', new.id, 'level', 1));
  return null;
end;
$$;

create trigger incidents_schedule_escalation
  after insert on public.incidents
  for each row execute function private.on_incident_insert_schedule();

-- =============================================================================================
-- The ladder
-- =============================================================================================

create function private.escalate_incident(p_incident_id uuid, p_level integer, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_policy   public.escalation_policies;
  v_levels   integer;
  v_target   text;
  v_org      uuid;
  v_name     text;
  v_next_at  timestamptz;
begin
  select * into v_incident from public.incidents where id = p_incident_id for update;
  -- Ended, acknowledged, or this level already happened: nothing to do.
  if not found or v_incident.status <> 'active' or v_incident.acknowledged_at is not null
     or p_level <= v_incident.escalation_level then
    return;
  end if;

  v_policy := private.policy_for(v_incident.assigned_org_id);
  v_levels := jsonb_array_length(v_policy.levels);
  v_target := case when p_level <= v_levels
                   then v_policy.levels -> (p_level - 1) ->> 'to' else 'parent' end;
  v_org := case when v_target = 'parent'
                then coalesce((select parent_id from public.organizations
                               where id = v_incident.assigned_org_id),
                              v_incident.assigned_org_id)
                else v_incident.assigned_org_id end;
  select name into v_name from public.organizations where id = v_org;

  update public.incidents
     set escalation_level = p_level, escalated_at = p_now
   where id = p_incident_id;
  insert into public.incident_escalations (incident_id, level, target, org_id, at)
  values (p_incident_id, p_level, v_target, v_org, p_now);
  -- Past the last level, every repeat also flags oversight.
  if p_level > v_levels then
    insert into public.incident_escalations (incident_id, level, target, org_id, at)
    values (p_incident_id, p_level, 'oversight', null, p_now);
  end if;

  perform private.ledger_append(
    p_action       => 'incident.escalated',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_build_object(
                        'level', p_level,
                        'to', v_target,
                        'org', v_org,
                        'org_name', v_name,
                        'oversight', p_level > v_levels,
                        'after_s', round(extract(epoch from p_now - v_incident.started_at))),
    p_occurred_at  => p_now
  );

  v_next_at := case
    when p_level < v_levels then v_incident.started_at
         + make_interval(secs => (v_policy.levels -> p_level ->> 'after_s')::integer)
    else p_now + make_interval(secs => v_policy.repeat_s)
  end;
  if p_level < 30 then
    insert into private.jobs (kind, run_at, payload)
    values ('incident.escalate', greatest(v_next_at, p_now),
            jsonb_build_object('incident_id', p_incident_id, 'level', p_level + 1));
  end if;
end;
$$;

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
    else
      raise exception 'Unknown job kind %', p_kind;
  end case;
end;
$$;

-- =============================================================================================
-- Live updates for the console
-- =============================================================================================

-- Adds 'org': pings the handling station and every organisation above it, so the board of
-- whoever may see the incident refreshes.
create or replace function private.broadcast_incident(p_incident_id uuid, p_what text, p_to text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_payload  jsonb := jsonb_build_object('what', p_what);
  v_org      uuid;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    return;
  end if;
  -- A live update must never break an SOS write.
  begin
    if 'incident' = any (p_to) then
      perform realtime.send(v_payload, 'changed', 'incident:' || v_incident.id::text, true);
    end if;
    if 'user' = any (p_to) then
      perform realtime.send(v_payload, 'changed', 'user:' || v_incident.citizen_id::text, true);
    end if;
    if 'live' = any (p_to) then
      perform realtime.send(v_payload, 'changed', 'live:' || v_incident.live_topic, false);
    end if;
    if 'org' = any (p_to) and v_incident.assigned_org_id is not null then
      for v_org in
        select v_incident.assigned_org_id
        union
        select private.org_ancestors(v_incident.assigned_org_id)
      loop
        perform realtime.send(v_payload, 'changed', 'org:' || v_org::text, true);
      end loop;
    end if;
  exception when others then
    raise warning 'Live update for incident % was not sent: %', p_incident_id, sqlerrm;
  end;
end;
$$;

create or replace function private.on_incident_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.broadcast_incident(new.id, 'status', array['user', 'org']);
  elsif old.status is distinct from new.status
        or old.closed_by_citizen_at is distinct from new.closed_by_citizen_at
        or old.response_state is distinct from new.response_state
        or old.escalation_level is distinct from new.escalation_level
        or old.assigned_org_id is distinct from new.assigned_org_id then
    perform private.broadcast_incident(new.id, 'status', array['incident', 'user', 'live', 'org']);
  elsif old.last_location_at is distinct from new.last_location_at then
    perform private.broadcast_incident(new.id, 'location', array['incident', 'live', 'org']);
  end if;
  return null;
end;
$$;

create or replace trigger incidents_broadcast_update
  after update on public.incidents
  for each row
  when (old.status is distinct from new.status
        or old.closed_by_citizen_at is distinct from new.closed_by_citizen_at
        or old.last_location_at is distinct from new.last_location_at
        or old.response_state is distinct from new.response_state
        or old.escalation_level is distinct from new.escalation_level
        or old.assigned_org_id is distinct from new.assigned_org_id)
  execute function private.on_incident_change();

-- Staff join `org:<id>` for organisations they belong to (or all, for admin and oversight), and
-- `incident:<id>` for incidents they may see.
create policy "Staff receive live updates for their organisations and incidents"
  on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (
      (
        (select realtime.topic()) ~ '^org:[0-9a-f-]{36}$'
        and (
          (select private.has_role(array['admin', 'oversight']::public.app_role[]))
          or exists (
            select 1 from public.memberships m
            where m.user_id = (select auth.uid())
              and 'org:' || m.org_id::text = (select realtime.topic())
          )
        )
      )
      or (
        (select realtime.topic()) ~ '^incident:[0-9a-f-]{36}$'
        and private.can_see_incident(substr((select realtime.topic()), 10)::uuid)
      )
    )
  );

-- =============================================================================================
-- Privileges
-- =============================================================================================

revoke all on function
  private.org_ancestors(uuid),
  private.default_org(),
  private.route_point(numeric, numeric),
  private.policy_for(uuid),
  private.on_incident_insert_route(),
  private.on_incident_first_fix(),
  private.on_incident_insert_schedule(),
  private.escalate_incident(uuid, integer, timestamptz)
  from public, anon, authenticated;

-- RLS policies and the Realtime check call these as the signed-in user.
revoke all on function private.can_see_incident(uuid) from public, anon;
grant execute on function private.can_see_incident(uuid) to authenticated, service_role;
