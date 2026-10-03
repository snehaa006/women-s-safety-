-- Phase 3, step 3b: the accountability lock and the supervisors' review queue.

-- Raising severity is free; going below the baseline needs a justification of at least 20
-- characters and opens a supervisor review.
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
