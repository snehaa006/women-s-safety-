-- Phase 1 part B, step 2: live updates. Database triggers ping Realtime topics; clients refetch.

-- =============================================================================================
-- Live updates (Supabase Realtime broadcast from the database)
-- =============================================================================================
--
-- Messages are pings ({"what": "location" | "status" | "responders" | "alerts"}); clients refetch
-- through the normal, RLS-checked reads. Topics:
--   incident:<id>    private, the citizen's SOS screen
--   user:<id>        private, the citizen's app shell (an SOS started from a wearable)
--   live:<topic>     public, the trusted-contact page (/t/:token); the name is a secret

create function private.broadcast_incident(p_incident_id uuid, p_what text, p_to text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_payload  jsonb := jsonb_build_object('what', p_what);
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
  exception when others then
    raise warning 'Live update for incident % was not sent: %', p_incident_id, sqlerrm;
  end;
end;
$$;

create function private.on_incident_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.broadcast_incident(new.id, 'status', array['user']);
  elsif old.status is distinct from new.status
        or old.closed_by_citizen_at is distinct from new.closed_by_citizen_at then
    perform private.broadcast_incident(new.id, 'status', array['incident', 'user', 'live']);
  elsif old.last_location_at is distinct from new.last_location_at then
    perform private.broadcast_incident(new.id, 'location', array['incident', 'live']);
  end if;
  return null;
end;
$$;

create trigger incidents_broadcast_insert
  after insert on public.incidents
  for each row execute function private.on_incident_change();

create trigger incidents_broadcast_update
  after update on public.incidents
  for each row
  when (old.status is distinct from new.status
        or old.closed_by_citizen_at is distinct from new.closed_by_citizen_at
        or old.last_location_at is distinct from new.last_location_at)
  execute function private.on_incident_change();

create function private.on_responder_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_incident(new.incident_id, 'responders', array['incident', 'live']);
  return null;
end;
$$;

create trigger incident_responders_broadcast
  after insert on public.incident_responders
  for each row execute function private.on_responder_added();

-- Alerts change in batches (one SOS queues several), so this fires once per statement.
create function private.on_alerts_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident uuid;
begin
  for v_incident in select distinct incident_id from changed loop
    perform private.broadcast_incident(v_incident, 'alerts', array['incident']);
  end loop;
  return null;
end;
$$;

create trigger alerts_broadcast_insert
  after insert on public.alerts
  referencing new table as changed
  for each statement execute function private.on_alerts_change();

create trigger alerts_broadcast_update
  after update on public.alerts
  referencing new table as changed
  for each statement execute function private.on_alerts_change();

create function private.on_share_link_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_incident(new.incident_id, 'alerts', array['incident']);
  return null;
end;
$$;

create trigger share_links_broadcast_opened
  after update of first_viewed_at on public.share_links
  for each row
  when (old.first_viewed_at is null and new.first_viewed_at is not null)
  execute function private.on_share_link_opened();

create trigger alerts_touch
  before update on public.alerts
  for each row execute function private.touch_updated_at();

-- Who may listen. Supabase Realtime checks these policies when a client joins a private topic.
create policy "Citizens receive live updates about their own SOS" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (
      (select realtime.topic()) = 'user:' || (select auth.uid())::text
      or exists (
        select 1
        from public.incidents i
        where i.citizen_id = (select auth.uid())
          and 'incident:' || i.id::text = (select realtime.topic())
      )
    )
  );

revoke all on function
  private.broadcast_incident(uuid, text, text[]),
  private.on_incident_change(),
  private.on_responder_added(),
  private.on_alerts_change(),
  private.on_share_link_opened()
  from public, anon, authenticated;
