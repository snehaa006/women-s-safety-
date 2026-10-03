-- Phase 1 part B, step 6: the Cron tick, nearby safe points, and privileges for everything new.

-- =============================================================================================
-- Timers: the Cron tick
-- =============================================================================================

-- Two minutes after an SOS: if nobody has said they're responding, remind the circle (L1).
-- This is the contact half of the escalation ladder; Phase 2 adds officers and supervisors.
create function private.remind_contacts(p_incident_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_alerts   integer;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found or v_incident.status <> 'active' then
    return;
  end if;
  if exists (select 1 from public.incident_responders r where r.incident_id = p_incident_id) then
    return;
  end if;

  v_alerts := private.queue_alerts(p_incident_id, 'reminder', 1::smallint);
  perform private.ledger_append(
    p_action       => 'sos.no_response',
    p_subject_type => 'incident',
    p_subject_id   => p_incident_id,
    p_payload      => jsonb_build_object(
                        'after_s', round(extract(epoch from p_now - v_incident.started_at)),
                        'reminders', v_alerts),
    p_occurred_at  => p_now
  );
end;
$$;

create function private.run_job(p_kind text, p_payload jsonb, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  case p_kind
    when 'sos.reminder' then
      perform private.remind_contacts((p_payload ->> 'incident_id')::uuid, p_now);
    else
      raise exception 'Unknown job kind %', p_kind;
  end case;
end;
$$;

-- Runs every 5 seconds from Supabase Cron. p_now lets tests travel in time. Idempotent: a job
-- runs once, and alerts are claimed with SKIP LOCKED by the notify function.
create function private.tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job    private.jobs;
  v_alert  public.alerts;
  v_jobs   integer := 0;
  v_failed integer := 0;
  v_due    boolean;
begin
  for v_job in
    select * from private.jobs
    where status = 'pending' and run_at <= p_now
    order by run_at
    limit 100
    for update skip locked
  loop
    begin
      perform private.run_job(v_job.kind, v_job.payload, p_now);
      update private.jobs
         set status = 'done', done_at = p_now, attempts = attempts + 1
       where id = v_job.id;
    exception when others then
      update private.jobs
         set attempts = attempts + 1,
             last_error = left(sqlerrm, 300),
             status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
             run_at = p_now + interval '30 seconds'
       where id = v_job.id;
    end;
    v_jobs := v_jobs + 1;
  end loop;

  -- A send that crashed mid-way goes back in the queue.
  update public.alerts
     set status = 'queued'
   where status = 'sending' and updated_at < p_now - interval '2 minutes';

  -- Never leave an alert waiting silently: after 15 minutes it is recorded as failed.
  for v_alert in
    update public.alerts
       set status = 'failed', last_error = 'Not delivered within 15 minutes'
     where status = 'queued' and created_at < p_now - interval '15 minutes'
    returning *
  loop
    perform private.ledger_append(
      p_action       => 'alert.failed',
      p_subject_type => 'incident',
      p_subject_id   => v_alert.incident_id,
      p_payload      => jsonb_build_object(
                          'alert', v_alert.id, 'channel', v_alert.channel,
                          'to', v_alert.recipient_name, 'template', v_alert.template,
                          'level', v_alert.level, 'reason', 'Not delivered within 15 minutes'),
      p_occurred_at  => p_now
    );
    v_failed := v_failed + 1;
  end loop;

  v_due := exists (
    select 1 from public.alerts where status = 'queued' and next_attempt_at <= p_now
  );
  if v_due then
    perform private.request_notify();
  end if;

  return jsonb_build_object('jobs', v_jobs, 'expired_alerts', v_failed, 'notified', v_due);
end;
$$;

do $$
begin
  -- pg_cron is enabled by the previous migration; plain Postgres (the tests) has no cron.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Cron keeps a log row per run (about 17,000 a day); pruning it is part of the Phase 9
    -- retention jobs.
    perform cron.schedule('platform-tick', '5 seconds', 'select private.tick()');
  end if;
end
$$;

-- =============================================================================================
-- Nearby safe points
-- =============================================================================================

-- The closest p_per_category places of each category within p_radius_m, nearest first.
-- Distances are great-circle (haversine); a bounding box keeps the scan on the index.
create function public.nearby_safe_points(
  p_lat          numeric,
  p_lng          numeric,
  p_per_category integer default 2,
  p_radius_m     integer default 10000
)
returns table (
  id         uuid,
  name       text,
  category   text,
  lat        numeric,
  lng        numeric,
  phone      text,
  address    text,
  distance_m integer
)
language sql
stable
set search_path = ''
as $$
  with box as (
    select least(greatest(coalesce(p_radius_m, 10000), 100), 50000) as radius,
           least(greatest(coalesce(p_per_category, 2), 1), 10) as per_category
  ),
  near as (
    select s.id, s.name, s.category, s.lat, s.lng, s.phone, s.address,
           round(2 * 6371000 * asin(least(1, sqrt(
             power(sin(radians((s.lat - p_lat)::float8) / 2), 2)
             + cos(radians(p_lat::float8)) * cos(radians(s.lat::float8))
               * power(sin(radians((s.lng - p_lng)::float8) / 2), 2)
           ))))::integer as distance_m,
           box.radius,
           box.per_category
    from public.safe_points s, box
    where s.lat between p_lat - box.radius / 111320.0 and p_lat + box.radius / 111320.0
      and s.lng between p_lng - box.radius / (111320.0 * greatest(cos(radians(p_lat::float8)), 0.01))
                    and p_lng + box.radius / (111320.0 * greatest(cos(radians(p_lat::float8)), 0.01))
  ),
  ranked as (
    select near.*, row_number() over (partition by near.category order by near.distance_m) as rn
    from near
    where near.distance_m <= near.radius
  )
  select r.id, r.name, r.category, r.lat, r.lng, r.phone, r.address, r.distance_m
  from ranked r
  where r.rn <= r.per_category
  order by r.distance_m
$$;

-- =============================================================================================
-- Privileges
-- =============================================================================================

revoke all on function
  private.remind_contacts(uuid, timestamptz),
  private.run_job(text, jsonb, timestamptz),
  private.tick(timestamptz)
  from public, anon, authenticated;

revoke all on function public.nearby_safe_points(numeric, numeric, integer, integer)
  from public, anon, authenticated;

-- Safe points are public information; the live-link page shows them too.
grant execute on function public.nearby_safe_points(numeric, numeric, integer, integer)
  to anon, authenticated, service_role;
