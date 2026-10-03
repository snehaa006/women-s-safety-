-- Phase 3, step 2b: citizens' complaint RPCs.

-- The instant rules answer, for the report screen to show while the citizen types.
create function public.triage_preview(p_text text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.triage_rules(left(p_text, 4000))
  where auth.uid() is not null
$$;

create function public.create_complaint(
  p_description  text,
  p_input_mode   text default 'text',
  p_occurred_at  timestamptz default null,
  p_lat          numeric default null,
  p_lng          numeric default null,
  p_accuracy_m   numeric default null,
  p_confidential boolean default false,
  p_client_id    uuid default null,
  p_incident_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_existing  public.complaints;
  v_linked    boolean := false;
  v_rules     jsonb;
  v_org       uuid;
  v_how       text;
  v_complaint public.complaints;
begin
  if v_uid is null then
    raise exception 'Sign in to report' using errcode = 'insufficient_privilege';
  end if;
  if p_client_id is not null then
    select * into v_existing from public.complaints
    where citizen_id = v_uid and client_id = p_client_id;
    if found then
      return jsonb_build_object('complaint_id', v_existing.id, 'reference', v_existing.reference,
                                'created', false);
    end if;
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Location needs both latitude and longitude' using errcode = 'invalid_parameter_value';
  end if;
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'That time is in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_incident_id is not null then
    select true into v_linked from public.incidents
    where id = p_incident_id and citizen_id = v_uid and status = 'active';
    if not found then
      raise exception 'No such active SOS' using errcode = 'no_data_found';
    end if;
  end if;

  v_rules := private.triage_rules(p_description, coalesce(v_linked, false));
  if p_lat is not null then
    select r.org_id, r.how into v_org, v_how from private.route_point(p_lat, p_lng) r;
  end if;
  if v_org is null then
    v_org := private.default_org();
    v_how := 'default';
  end if;

  insert into public.complaints (
    reference, citizen_id, client_id, description, input_mode, occurred_at, lat, lng, accuracy_m,
    incident_id, confidential, alias, category, severity, baseline_severity, rules,
    assigned_org_id, routed_how, sla_due_at
  ) values (
    'C-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.complaint_ref_seq')::text, 6, '0'),
    v_uid, p_client_id, btrim(p_description), coalesce(p_input_mode, 'text'), p_occurred_at,
    p_lat, p_lng, p_accuracy_m, p_incident_id, coalesce(p_confidential, false),
    'Reporter ' || upper(substr(md5(gen_random_uuid()::text), 1, 4)),
    v_rules ->> 'category', (v_rules ->> 'severity')::smallint, (v_rules ->> 'severity')::smallint,
    v_rules, v_org, v_how,
    now() + make_interval(secs => private.complaint_ack_s((v_rules ->> 'severity')::smallint))
  )
  returning * into v_complaint;

  -- The ledger keeps what was reported and the rules' answer, not who reported it: the actor is
  -- recorded as usual, and officers never see actor ids.
  perform private.ledger_append(
    p_action       => 'complaint.filed',
    p_subject_type => 'complaint',
    p_subject_id   => v_complaint.id,
    p_payload      => jsonb_build_object(
                        'reference', v_complaint.reference,
                        'description_sha256', encode(extensions.digest(v_complaint.description, 'sha256'), 'hex'),
                        'input', v_complaint.input_mode,
                        'confidential', v_complaint.confidential,
                        'category', v_complaint.category,
                        'severity', v_complaint.severity,
                        'signals', v_rules -> 'signals',
                        'org', v_org,
                        'how', v_how),
    p_lat          => p_lat,
    p_lng          => p_lng,
    p_accuracy_m   => p_accuracy_m
  );

  insert into private.jobs (kind, run_at, payload) values
    ('complaint.escalate', v_complaint.sla_due_at,
     jsonb_build_object('complaint_id', v_complaint.id, 'level', 1)),
    ('complaint.triage_check', now() + interval '45 seconds',
     jsonb_build_object('complaint_id', v_complaint.id, 'try', 1));
  perform private.request_triage();

  return jsonb_build_object(
    'complaint_id', v_complaint.id,
    'reference', v_complaint.reference,
    'created', true,
    'category', v_complaint.category,
    'severity', v_complaint.severity,
    'rationale', v_rules ->> 'rationale',
    'sla_due_at', v_complaint.sla_due_at,
    'org_name', (select name from public.organizations where id = v_org)
  );
end;
$$;

-- Consent: lets officers see who filed a confidential complaint. Cannot be undone.
create function public.share_complaint_identity(p_complaint_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.complaints
     set identity_shared_at = now()
   where id = p_complaint_id and citizen_id = auth.uid() and confidential
     and identity_shared_at is null;
  if found then
    perform private.ledger_append(
      p_action       => 'complaint.identity_shared',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id
    );
  end if;
end;
$$;
