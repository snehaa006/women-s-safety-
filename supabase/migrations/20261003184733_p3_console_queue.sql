-- Phase 3, step 3: the complaint queue and workbench.
--
-- Officers read complaints only through these RPCs. A confidential reporter appears as an alias
-- (no name, phone or account id) until they choose to share their identity.

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
