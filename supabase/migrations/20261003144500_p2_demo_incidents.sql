-- Phase 2, step 4: mock incidents for demos and training.
--
-- admin_load_demo_incidents() closes the previous demo incidents and starts three new ones from
-- three mock citizens (accounts nobody can sign in to), in three jurisdictions, backdated 40 s,
-- 3.5 min and 6 min. Within a tick or two the board shows escalation levels 0, 1 and 2, and
-- the ladder keeps running live until someone acknowledges.

create function public.admin_load_demo_incidents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident uuid;
  v_unit     uuid;
  v_count    integer := 0;
  v_demo     record;
begin
  if not private.has_role(array['admin', 'supervisor']::public.app_role[]) then
    raise exception 'Only an admin or a supervisor can load demo incidents'
      using errcode = 'insufficient_privilege';
  end if;

  -- Close the previous round.
  for v_incident, v_unit in
    update public.incidents
       set status = 'resolved', resolved_at = now(), close_code = 'duplicate',
           close_note = 'Demo reset', closed_by = auth.uid()
     where is_demo and status = 'active'
    returning id, unit_id
  loop
    update public.patrol_units set status = 'available' where id = v_unit;
    perform private.ledger_append(
      p_action       => 'incident.closed',
      p_subject_type => 'incident',
      p_subject_id   => v_incident,
      p_payload      => jsonb_build_object('code', 'duplicate', 'note', 'Demo reset')
    );
  end loop;

  for v_demo in
    select * from (values
      ('00000000-0000-4000-8000-0000000000d1'::uuid, 'Ananya Verma (demo)', '+91 90000 00001',
       28.6315::numeric, 77.2167::numeric, interval '40 seconds', 78),
      ('00000000-0000-4000-8000-0000000000d2'::uuid, 'Kavya Iyer (demo)', '+91 90000 00002',
       28.6098::numeric, 77.2405::numeric, interval '210 seconds', 41),
      ('00000000-0000-4000-8000-0000000000d3'::uuid, 'Riya Sen (demo)', '+91 90000 00003',
       28.6423::numeric, 77.1981::numeric, interval '360 seconds', 17)
    ) as d (id, full_name, phone, lat, lng, age, battery)
  loop
    -- A mock citizen: an auth user without a password, so nobody can sign in as them.
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_demo.id, replace(v_demo.id::text, '-', '') || '@demo.invalid',
            jsonb_build_object('full_name', v_demo.full_name))
    on conflict (id) do nothing;
    update public.profiles set phone = v_demo.phone where id = v_demo.id;

    v_incident := (private.start_incident(
      p_citizen_id  => v_demo.id,
      p_source      => 'simulator',
      p_lat         => v_demo.lat,
      p_lng         => v_demo.lng,
      p_accuracy_m  => 12,
      p_battery_pct => v_demo.battery,
      p_occurred_at => now() - v_demo.age
    ) ->> 'incident_id')::uuid;
    update public.incidents set is_demo = true where id = v_incident;

    -- A few more points, walking north-east.
    for i in 1..4 loop
      perform private.add_ping(v_incident, v_demo.lat + i * 0.0004, v_demo.lng + i * 0.0003,
                               10, 1.2, 40, v_demo.battery, 'simulator');
    end loop;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.admin_load_demo_incidents is
  'Demo and training: replaces the active demo incidents with three new ones. Admin or supervisor.';

revoke all on function public.admin_load_demo_incidents() from public, anon;
grant execute on function public.admin_load_demo_incidents() to authenticated, service_role;
