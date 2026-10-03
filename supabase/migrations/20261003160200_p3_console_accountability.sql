-- Phase 3, step 3: the complaint queue and workbench, and the accountability lock.
--
-- Officers read complaints only through these RPCs. A confidential reporter appears as an alias
-- (no name, phone or account id) until they choose to share their identity. Lowering severity
-- below the AI baseline needs a written justification and lands in a supervisor's review queue.

-- What officers see of the reporter.
create function private.complaint_reporter(p_complaint public.complaints)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_complaint.confidential and p_complaint.identity_shared_at is null then
      jsonb_build_object('confidential', true, 'alias', p_complaint.alias,
                         'name', null, 'phone', null)
    else
      jsonb_build_object('confidential', p_complaint.confidential, 'alias', p_complaint.alias,
                         'name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed citizen'),
                         'phone', p.phone,
                         'shared_at', p_complaint.identity_shared_at)
    end
  from public.profiles p
  where p.id = p_complaint.citizen_id
$$;

create function private.complaint_row(p_complaint public.complaints)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_complaint.id,
    'reference', p_complaint.reference,
    'status', p_complaint.status,
    'category', p_complaint.category,
    'category_label', (select t.label from private.triage_categories t
                       where t.category = p_complaint.category),
    'severity', p_complaint.severity,
    'baseline_severity', p_complaint.baseline_severity,
    'triage_state', p_complaint.triage_state,
    'excerpt', left(p_complaint.description, 160),
    'input_mode', p_complaint.input_mode,
    'created_at', p_complaint.created_at,
    'occurred_at', p_complaint.occurred_at,
    'sla_due_at', p_complaint.sla_due_at,
    'acknowledged_at', p_complaint.acknowledged_at,
    'escalation_level', p_complaint.escalation_level,
    'org_id', p_complaint.assigned_org_id,
    'org_name', (select o.name from public.organizations o
                 where o.id = p_complaint.assigned_org_id),
    'reporter', private.complaint_reporter(p_complaint),
    'is_demo', p_complaint.is_demo,
    'pending_review', exists (select 1 from public.severity_overrides s
                              where s.complaint_id = p_complaint.id
                                and s.review_status = 'pending')
  )
$$;

-- Open complaints the caller may see: unacknowledged first, by time left; then the rest, newest
-- first.
create function public.console_complaints()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.complaint_row(c)
                            order by (c.acknowledged_at is null) desc,
                                     case when c.acknowledged_at is null then c.sla_due_at end,
                                     c.severity desc, c.created_at desc), '[]'::jsonb)
  from public.complaints c
  where c.status not in ('resolved', 'closed') and private.can_see_complaint(c.id)
$$;

create function public.console_complaint(p_complaint_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id;
  if not found or not private.can_see_complaint(p_complaint_id) then
    raise exception 'No such complaint' using errcode = 'no_data_found';
  end if;

  return private.complaint_row(v_complaint) || jsonb_build_object(
    'description', v_complaint.description,
    'location', case when v_complaint.lat is null then null else jsonb_build_object(
      'lat', v_complaint.lat, 'lng', v_complaint.lng, 'accuracy_m', v_complaint.accuracy_m) end,
    'incident_id', v_complaint.incident_id,
    'rules', v_complaint.rules,
    'ai', v_complaint.ai,
    'resolved_at', v_complaint.resolved_at,
    'outcome_note', v_complaint.outcome_note,
    'acknowledged_by', (select p.full_name from public.profiles p
                        where p.id = v_complaint.acknowledged_by),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'from', s.from_severity, 'to', s.to_severity,
               'baseline', s.baseline_severity, 'justification', s.justification,
               'officer', op.full_name, 'at', s.created_at,
               'review_status', s.review_status, 'reviewed_by', rp.full_name,
               'reviewed_at', s.reviewed_at, 'review_note', s.review_note) order by s.created_at)
      from public.severity_overrides s
      join public.profiles op on op.id = s.officer_id
      left join public.profiles rp on rp.id = s.reviewed_by
      where s.complaint_id = p_complaint_id
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', e.seq, 'occurred_at', e.occurred_at, 'action', e.action,
               'actor_role', e.actor_role, 'payload', e.payload) order by e.seq)
      from public.ledger_entries e
      where e.subject_type = 'complaint' and e.subject_id = p_complaint_id
    ), '[]'::jsonb)
  );
end;
$$;

create function private.complaint_for_action(p_complaint_id uuid)
returns public.complaints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
begin
  if not private.can_see_complaint(p_complaint_id) then
    raise exception 'No such complaint' using errcode = 'no_data_found';
  end if;
  select * into v_complaint from public.complaints where id = p_complaint_id for update;
  if v_complaint.status in ('resolved', 'closed') then
    raise exception 'This complaint is closed' using errcode = 'check_violation';
  end if;
  return v_complaint;
end;
$$;

create function public.acknowledge_complaint(p_complaint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints := private.complaint_for_action(p_complaint_id);
begin
  if v_complaint.acknowledged_at is null then
    update public.complaints
       set acknowledged_at = now(), acknowledged_by = auth.uid(),
           status = case when status = 'submitted' then 'acknowledged' else status end
     where id = p_complaint_id;
    perform private.ledger_append(
      p_action       => 'complaint.acknowledged',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object(
                          'after_s', round(extract(epoch from now() - v_complaint.created_at)),
                          'within_sla', now() <= v_complaint.sla_due_at,
                          'severity', v_complaint.severity)
    );
  end if;
  return jsonb_build_object('acknowledged', true);
end;
$$;

-- in_progress, resolved or closed. Resolving or closing needs a note for the citizen.
create function public.set_complaint_status(p_complaint_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status not in ('in_progress', 'resolved', 'closed') then
    raise exception 'Unknown status' using errcode = 'invalid_parameter_value';
  end if;
  if p_status in ('resolved', 'closed') and v_note is null then
    raise exception 'Write a note for the citizen' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'The note can be up to 1000 characters' using errcode = 'invalid_parameter_value';
  end if;
  v_complaint := private.complaint_for_action(p_complaint_id);
  perform public.acknowledge_complaint(p_complaint_id);

  update public.complaints
     set status = p_status,
         resolved_at = case when p_status in ('resolved', 'closed') then now() end,
         outcome_note = coalesce(v_note, outcome_note)
   where id = p_complaint_id;
  perform private.ledger_append(
    p_action       => 'complaint.status_changed',
    p_subject_type => 'complaint',
    p_subject_id   => p_complaint_id,
    p_payload      => jsonb_strip_nulls(jsonb_build_object(
                        'from', v_complaint.status, 'to', p_status, 'note', v_note))
  );
  return jsonb_build_object('status', p_status);
end;
$$;

-- The accountability lock. Raising severity is free; going below the AI baseline needs a
-- justification of at least 20 characters and opens a supervisor review.
create function public.set_complaint_severity(
  p_complaint_id  uuid,
  p_severity      integer,
  p_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint     public.complaints;
  v_justification text := nullif(btrim(coalesce(p_justification, '')), '');
  v_override      uuid;
begin
  if p_severity is null or p_severity not between 1 and 5 then
    raise exception 'Severity is 1 to 5' using errcode = 'invalid_parameter_value';
  end if;
  v_complaint := private.complaint_for_action(p_complaint_id);
  if p_severity = v_complaint.severity then
    return jsonb_build_object('severity', p_severity, 'review', false);
  end if;

  if p_severity < v_complaint.baseline_severity then
    if v_justification is null or char_length(v_justification) < 20 then
      raise exception 'Going below the AI baseline (L%) needs a justification of at least 20 characters',
        v_complaint.baseline_severity using errcode = 'check_violation';
    end if;
    insert into public.severity_overrides (
      complaint_id, org_id, from_severity, to_severity, baseline_severity, justification, officer_id)
    values (p_complaint_id, v_complaint.assigned_org_id, v_complaint.severity, p_severity,
            v_complaint.baseline_severity, left(v_justification, 1000), auth.uid())
    returning id into v_override;
    perform private.ledger_append(
      p_action       => 'complaint.severity_overridden',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object(
                          'from', v_complaint.severity, 'to', p_severity,
                          'baseline', v_complaint.baseline_severity,
                          'justification', left(v_justification, 1000),
                          'override', v_override)
    );
  else
    perform private.ledger_append(
      p_action       => 'complaint.severity_changed',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_strip_nulls(jsonb_build_object(
                          'from', v_complaint.severity, 'to', p_severity, 'note', v_justification))
    );
  end if;

  update public.complaints set severity = p_severity where id = p_complaint_id;
  perform private.reset_complaint_sla(p_complaint_id, now());
  return jsonb_build_object('severity', p_severity, 'review', v_override is not null);
end;
$$;

-- Supervisors' queue: pending downgrades in their organisations and those below, oldest first,
-- grouped by week on screen. Admins and oversight see all of them.
create function public.console_reviews()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'complaint_id', c.id,
           'reference', c.reference,
           'category_label', (select t.label from private.triage_categories t
                              where t.category = c.category),
           'excerpt', left(c.description, 160),
           'from', s.from_severity,
           'to', s.to_severity,
           'baseline', s.baseline_severity,
           'justification', s.justification,
           'officer', op.full_name,
           'org_name', o.name,
           'at', s.created_at,
           'week', date_trunc('week', s.created_at)) order by s.created_at), '[]'::jsonb)
  from public.severity_overrides s
  join public.complaints c on c.id = s.complaint_id
  join public.profiles op on op.id = s.officer_id
  left join public.organizations o on o.id = s.org_id
  where s.review_status = 'pending'
    and s.officer_id <> auth.uid()
    and (
      private.has_role(array['admin', 'oversight']::public.app_role[])
      or (private.has_role(array['supervisor']::public.app_role[])
          and exists (
            select 1 from public.memberships m
            where m.user_id = auth.uid()
              and (m.org_id = s.org_id or m.org_id in (select private.org_ancestors(s.org_id)))))
    )
$$;

-- Upheld: the lower severity stays. Reversed: severity goes back to the baseline.
create function public.review_override(p_override_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override  public.severity_overrides;
  v_complaint public.complaints;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('upheld', 'reversed') then
    raise exception 'Decide upheld or reversed' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_override from public.severity_overrides where id = p_override_id for update;
  if not found or v_override.review_status <> 'pending'
     or not (public.console_reviews() @> jsonb_build_array(jsonb_build_object('id', p_override_id))) then
    raise exception 'No such review' using errcode = 'no_data_found';
  end if;
  if p_decision = 'reversed' and v_note is null then
    raise exception 'Say why the downgrade is reversed' using errcode = 'invalid_parameter_value';
  end if;

  update public.severity_overrides
     set review_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = left(v_note, 1000)
   where id = p_override_id;

  select * into v_complaint from public.complaints where id = v_override.complaint_id for update;
  if p_decision = 'reversed' and v_complaint.severity < v_complaint.baseline_severity then
    update public.complaints set severity = v_complaint.baseline_severity
     where id = v_complaint.id;
    perform private.reset_complaint_sla(v_complaint.id, now());
  end if;

  perform private.ledger_append(
    p_action       => 'complaint.override_reviewed',
    p_subject_type => 'complaint',
    p_subject_id   => v_override.complaint_id,
    p_payload      => jsonb_strip_nulls(jsonb_build_object(
                        'override', p_override_id, 'decision', p_decision,
                        'severity', case when p_decision = 'reversed'
                                         then v_complaint.baseline_severity
                                         else v_complaint.severity end,
                        'note', v_note))
  );
  return jsonb_build_object('decision', p_decision);
end;
$$;

-- =============================================================================================
-- Demo complaints
-- =============================================================================================

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

-- =============================================================================================
-- Privileges
-- =============================================================================================

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
