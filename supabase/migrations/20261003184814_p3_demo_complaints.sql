-- Phase 3, step 3c: demo complaints, and privileges for the console RPCs.

-- Admins and supervisors: closes earlier demo complaints and files four fresh ones from the
-- demo citizens (created by admin_load_demo_incidents or here), at different stages.
create function public.admin_load_demo_complaints()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo  record;
  v_id    uuid;
  v_rules jsonb;
  v_count integer := 0;
begin
  if not private.has_role(array['admin', 'supervisor']::public.app_role[]) then
    raise exception 'Only admins and supervisors can load demo data'
      using errcode = 'insufficient_privilege';
  end if;

  update public.complaints
     set status = 'closed', resolved_at = now(), outcome_note = 'Demo data replaced'
   where is_demo and status not in ('resolved', 'closed');

  for v_demo in
    select * from (values
      ('00000000-0000-4000-8000-0000000000d1'::uuid, 'Ananya Verma (demo)',
       'ek aadmi metro se mera peecha kar raha hai, Rajiv Chowk se', 28.6328, 77.2197, 4, false),
      ('00000000-0000-4000-8000-0000000000d2'::uuid, 'Kavya Iyer (demo)',
       'Someone groped me in the bus near Tilak Marg just now', 28.6125, 77.2385, 1, true),
      ('00000000-0000-4000-8000-0000000000d3'::uuid, 'Riya Sen (demo)',
       'Yesterday a group of boys passed comments at me near the market', 28.6390, 77.2050, 40, false),
      ('00000000-0000-4000-8000-0000000000d1'::uuid, 'Ananya Verma (demo)',
       'The street lights on the lane behind the college are broken, it is very dark at night',
       28.6335, 77.2125, 60, false)
    ) as d(citizen, name, text, lat, lng, age_min, confidential)
  loop
    -- The same mock citizens as the demo incidents: no password, nobody can sign in as them.
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_demo.citizen, replace(v_demo.citizen::text, '-', '') || '@demo.invalid',
            jsonb_build_object('full_name', v_demo.name))
    on conflict (id) do nothing;

    v_rules := private.triage_rules(v_demo.text);
    insert into public.complaints (
      reference, citizen_id, description, lat, lng, accuracy_m, confidential, alias, category,
      severity, baseline_severity, rules, triage_state, assigned_org_id, routed_how,
      sla_due_at, is_demo, created_at, occurred_at
    )
    select 'C-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.complaint_ref_seq')::text, 6, '0'),
           v_demo.citizen, v_demo.text, v_demo.lat, v_demo.lng, 15, v_demo.confidential,
           'Reporter ' || upper(substr(md5(gen_random_uuid()::text), 1, 4)),
           v_rules ->> 'category', (v_rules ->> 'severity')::smallint,
           (v_rules ->> 'severity')::smallint, v_rules, 'skipped',
           coalesce(r.org_id, private.default_org()), coalesce(r.how, 'default'),
           now() - make_interval(mins => v_demo.age_min)
             + make_interval(secs => private.complaint_ack_s((v_rules ->> 'severity')::smallint)),
           true, now() - make_interval(mins => v_demo.age_min),
           now() - make_interval(mins => v_demo.age_min + 5)
    from (select 1) one
    left join lateral private.route_point(v_demo.lat, v_demo.lng) r on true
    returning id into v_id;

    perform private.ledger_append(
      p_action       => 'complaint.filed',
      p_subject_type => 'complaint',
      p_subject_id   => v_id,
      p_payload      => jsonb_build_object('demo', true, 'category', v_rules ->> 'category',
                                           'severity', (v_rules ->> 'severity')::smallint),
      p_actor_id     => v_demo.citizen
    );
    -- Escalate at once if it is already overdue.
    insert into private.jobs (kind, run_at, payload)
    select 'complaint.escalate', c.sla_due_at, jsonb_build_object('complaint_id', c.id, 'level', 1)
    from public.complaints c where c.id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function
  private.complaint_reporter(public.complaints),
  private.complaint_row(public.complaints),
  private.complaint_for_action(uuid)
  from public, anon, authenticated;

revoke all on function
  public.console_complaints(),
  public.console_complaint(uuid),
  public.acknowledge_complaint(uuid),
  public.set_complaint_status(uuid, text, text),
  public.set_complaint_severity(uuid, integer, text),
  public.console_reviews(),
  public.review_override(uuid, text, text),
  public.admin_load_demo_complaints()
  from public, anon;
grant execute on function
  public.console_complaints(),
  public.console_complaint(uuid),
  public.acknowledge_complaint(uuid),
  public.set_complaint_status(uuid, text, text),
  public.set_complaint_severity(uuid, integer, text),
  public.console_reviews(),
  public.review_override(uuid, text, text),
  public.admin_load_demo_complaints()
  to authenticated, service_role;
