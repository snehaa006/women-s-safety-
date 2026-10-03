-- Phase 3, step 2: filing a complaint, routing it, the SLA ladder and the asynchronous AI triage.
--
-- Filing runs the rules triage in the same transaction (instant answer), routes the complaint
-- to a station by location and schedules its SLA check. The AI triage is a queue: the `triage`
-- Edge Function claims complaints with claim_triage() and reports with finish_triage(), both
-- service-role only, so the function trusts no caller (like `notify`).

-- =============================================================================================
-- Helpers
-- =============================================================================================

-- Seconds allowed to acknowledge at a severity.
create function private.complaint_ack_s(p_severity smallint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.ack_s from public.complaint_sla s where s.severity = p_severity), 1800)
$$;

-- Same rule as incidents: admins and oversight see everything, the handling station sees its
-- complaints, the organisation above sees them once raised to it (and its supervisors always).
create function private.can_see_complaint(p_complaint_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['admin', 'oversight']::public.app_role[])
    or exists (
      select 1
      from public.complaints c
      join public.memberships m on m.user_id = auth.uid()
      where c.id = p_complaint_id
        and private.has_role(array['officer', 'supervisor']::public.app_role[])
        and (
          m.org_id = c.assigned_org_id
          or (m.org_id in (select private.org_ancestors(c.assigned_org_id))
              and (c.escalation_level >= 2 or m.role = 'supervisor'))
        )
    )
$$;

-- Pings the handling station and the organisations above it, and the citizen.
create function private.broadcast_complaint(p_complaint_id uuid, p_what text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
  v_payload   jsonb := jsonb_build_object('what', p_what, 'complaint', p_complaint_id);
  v_org       uuid;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id;
  if not found then
    return;
  end if;
  begin
    perform realtime.send(v_payload, 'changed', 'user:' || v_complaint.citizen_id::text, true);
    if v_complaint.assigned_org_id is not null then
      for v_org in
        select v_complaint.assigned_org_id
        union
        select private.org_ancestors(v_complaint.assigned_org_id)
      loop
        perform realtime.send(v_payload, 'changed', 'org:' || v_org::text, true);
      end loop;
    end if;
  exception when others then
    raise warning 'Live update for complaint % was not sent: %', p_complaint_id, sqlerrm;
  end;
end;
$$;

create function private.on_complaint_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_complaint(new.id, 'complaint');
  return null;
end;
$$;

create trigger complaints_broadcast
  after insert or update on public.complaints
  for each row execute function private.on_complaint_change();

-- Asks the triage function to look at the queue (pg_net; a no-op without it, as in the tests).
create function private.request_triage()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from private.settings where key = 'functions_url';
  if v_url is null
     or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return;
  end if;
  perform net.http_post(
    url                  => v_url || '/triage',
    body                 => '{}'::jsonb,
    params               => '{}'::jsonb,
    headers              => '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds => 10000
  );
exception when others then
  raise warning 'Could not request the triage function: %', sqlerrm;
end;
$$;

-- Moves the SLA deadline to match the current severity (while unacknowledged) and schedules a
-- check for it. An earlier check that finds the deadline moved later simply does nothing.
create function private.reset_complaint_sla(p_complaint_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
  v_due       timestamptz;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id;
  if v_complaint.acknowledged_at is not null or v_complaint.escalation_level > 0 then
    return;
  end if;
  v_due := v_complaint.created_at
           + make_interval(secs => private.complaint_ack_s(v_complaint.severity));
  if v_due is distinct from v_complaint.sla_due_at then
    update public.complaints set sla_due_at = v_due where id = p_complaint_id;
    insert into private.jobs (kind, run_at, payload)
    values ('complaint.escalate', greatest(v_due, p_now),
            jsonb_build_object('complaint_id', p_complaint_id, 'level', 1));
  end if;
end;
$$;

-- =============================================================================================
-- The SLA ladder
-- =============================================================================================

-- Level 1: the SLA was missed; the station's queue flashes red. Level 2: raised to the
-- organisation above. Then a repeat every repeat_s that also flags oversight.
create function private.escalate_complaint(p_complaint_id uuid, p_level integer, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
  v_policy    public.escalation_policies;
  v_target    text;
  v_org       uuid;
  v_org_name  text;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id for update;
  if not found
     or v_complaint.acknowledged_at is not null
     or v_complaint.status in ('resolved', 'closed')
     or v_complaint.escalation_level >= p_level
     or v_complaint.sla_due_at > p_now then
    return;
  end if;

  v_policy := private.policy_for(v_complaint.assigned_org_id);
  v_target := case when p_level = 1 then 'station' else 'parent' end;
  v_org := case when v_target = 'station' then v_complaint.assigned_org_id
                else coalesce((select o.parent_id from public.organizations o
                               where o.id = v_complaint.assigned_org_id),
                              v_complaint.assigned_org_id) end;
  select name into v_org_name from public.organizations where id = v_org;

  update public.complaints set escalation_level = p_level, escalated_at = p_now
   where id = p_complaint_id;

  perform private.ledger_append(
    p_action       => 'complaint.escalated',
    p_subject_type => 'complaint',
    p_subject_id   => p_complaint_id,
    p_payload      => jsonb_build_object(
                        'level', p_level,
                        'to', v_target,
                        'org', v_org,
                        'org_name', v_org_name,
                        'oversight', p_level > 2,
                        'severity', v_complaint.severity,
                        'overdue_s', round(extract(epoch from p_now - v_complaint.sla_due_at))),
    p_occurred_at  => p_now
  );

  if p_level < 30 then
    insert into private.jobs (kind, run_at, payload)
    values ('complaint.escalate', p_now + make_interval(secs => v_policy.repeat_s),
            jsonb_build_object('complaint_id', p_complaint_id, 'level', p_level + 1));
  end if;
end;
$$;

-- Re-asks the triage function while a complaint waits, and gives up after three tries.
create function private.check_triage(p_complaint_id uuid, p_try integer, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id for update;
  if not found or v_complaint.triage_state <> 'pending' then
    return;
  end if;
  if p_try >= 3 then
    update public.complaints set triage_state = 'failed' where id = p_complaint_id;
    perform private.ledger_append(
      p_action       => 'complaint.ai_failed',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object('reason', 'The AI triage did not answer'),
      p_occurred_at  => p_now
    );
    return;
  end if;
  -- A claim older than a minute is treated as lost.
  update public.complaints set triage_claimed_at = null
   where id = p_complaint_id and triage_claimed_at < p_now - interval '1 minute';
  perform private.request_triage();
  insert into private.jobs (kind, run_at, payload)
  values ('complaint.triage_check', p_now + interval '60 seconds',
          jsonb_build_object('complaint_id', p_complaint_id, 'try', p_try + 1));
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
    when 'complaint.escalate' then
      perform private.escalate_complaint((p_payload ->> 'complaint_id')::uuid,
                                         (p_payload ->> 'level')::integer, p_now);
    when 'complaint.triage_check' then
      perform private.check_triage((p_payload ->> 'complaint_id')::uuid,
                                   (p_payload ->> 'try')::integer, p_now);
    else
      raise exception 'Unknown job kind %', p_kind;
  end case;
end;
$$;

-- =============================================================================================
-- Citizens
-- =============================================================================================

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

-- The citizen's timeline of one complaint. Override justifications stay internal.
create function public.complaint_timeline(p_complaint_id uuid)
returns table (seq bigint, occurred_at timestamptz, action text, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.seq, e.occurred_at, e.action,
         case when e.action = 'complaint.severity_overridden'
              then e.payload - 'justification' - 'officer'
              else e.payload end
  from public.ledger_entries e
  join public.complaints c on c.id = e.subject_id
  where e.subject_type = 'complaint' and e.subject_id = p_complaint_id
    and c.citizen_id = auth.uid()
    and e.action <> 'complaint.override_reviewed'
  order by e.seq
$$;

-- =============================================================================================
-- The AI triage queue (service role only)
-- =============================================================================================

create function public.claim_triage(p_limit integer default 5)
returns table (
  complaint_id uuid,
  description  text,
  occurred_at  timestamptz,
  created_at   timestamptz,
  rules        jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select c.id from public.complaints c
    where c.triage_state = 'pending'
      and (c.triage_claimed_at is null or c.triage_claimed_at < now() - interval '1 minute')
    order by c.created_at
    limit least(greatest(p_limit, 1), 20)
    for update skip locked
  )
  update public.complaints c
     set triage_claimed_at = now(), triage_attempts = c.triage_attempts + 1
    from due
   where c.id = due.id
  returning c.id, c.description, c.occurred_at, c.created_at, c.rules;
end;
$$;

-- p_outcome: 'done' with p_result {category, severity, confidence, signals, rationale,
-- legal_tags, provider, model}; 'skipped' when no model is configured; 'failed' with p_retry.
create function public.finish_triage(
  p_complaint_id uuid,
  p_outcome      text,
  p_result       jsonb default null,
  p_error        text default null,
  p_retry        boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
  v_severity  smallint;
  v_category  text;
  v_baseline  smallint;
  v_ai        jsonb;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id for update;
  if not found or v_complaint.triage_state <> 'pending' then
    return 'ignored';
  end if;

  if p_outcome = 'skipped' then
    update public.complaints set triage_state = 'skipped', triage_claimed_at = null
     where id = p_complaint_id;
    perform private.ledger_append(
      p_action       => 'complaint.ai_skipped',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object('reason', coalesce(left(p_error, 200), 'No AI model is set up'))
    );
    return 'skipped';
  end if;

  if p_outcome <> 'done' then
    if p_retry and v_complaint.triage_attempts < 3 then
      update public.complaints set triage_claimed_at = null where id = p_complaint_id;
      return 'retry';
    end if;
    update public.complaints set triage_state = 'failed', triage_claimed_at = null
     where id = p_complaint_id;
    perform private.ledger_append(
      p_action       => 'complaint.ai_failed',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object('reason', coalesce(left(p_error, 200), 'Unknown error'))
    );
    return 'failed';
  end if;

  -- Never trust the model's shape: unknown categories fall back to the rules', and severity is
  -- clamped to the rubric.
  v_severity := case when jsonb_typeof(p_result -> 'severity') = 'number'
                     then least(greatest((p_result ->> 'severity')::numeric, 1), 5)::smallint end;
  if v_severity is null then
    return public.finish_triage(p_complaint_id, 'failed', null, 'The model returned no severity', false);
  end if;
  v_category := case when exists (select 1 from private.triage_categories t
                                  where t.category = p_result ->> 'category')
                     then p_result ->> 'category' else v_complaint.rules ->> 'category' end;
  v_baseline := greatest((v_complaint.rules ->> 'severity')::smallint, v_severity);
  v_ai := jsonb_build_object(
    'category', v_category,
    'severity', v_severity,
    'confidence', case when jsonb_typeof(p_result -> 'confidence') = 'number'
                       then least(greatest((p_result ->> 'confidence')::numeric, 0), 1) end,
    'signals', coalesce(p_result -> 'signals', '[]'::jsonb),
    'rationale', left(p_result ->> 'rationale', 600),
    'legal_tags', coalesce(p_result -> 'legal_tags', '[]'::jsonb),
    'provider', left(p_result ->> 'provider', 40),
    'model', left(p_result ->> 'model', 80),
    'rules_floor', (v_complaint.rules ->> 'severity')::smallint,
    'final', v_baseline,
    'version', 'triage-v1',
    'at', now()
  );

  update public.complaints
     set ai = v_ai,
         triage_state = 'done',
         triage_claimed_at = null,
         category = v_category,
         baseline_severity = greatest(baseline_severity, v_baseline),
         -- The model can raise severity, never lower it; an officer's higher setting stays.
         severity = greatest(severity, v_baseline)
   where id = p_complaint_id;

  perform private.ledger_append(
    p_action       => 'complaint.ai_triaged',
    p_subject_type => 'complaint',
    p_subject_id   => p_complaint_id,
    p_payload      => jsonb_build_object(
                        'category', v_category,
                        'model_severity', v_severity,
                        'rules_floor', (v_complaint.rules ->> 'severity')::smallint,
                        'severity', greatest(v_complaint.severity, v_baseline),
                        'raised', greatest(v_complaint.severity, v_baseline) > v_complaint.severity,
                        'provider', v_ai ->> 'provider',
                        'model', v_ai ->> 'model')
  );
  -- A higher severity tightens the SLA.
  perform private.reset_complaint_sla(p_complaint_id, now());
  return 'done';
end;
$$;

-- =============================================================================================
-- Privileges
-- =============================================================================================

revoke all on function
  private.complaint_ack_s(smallint),
  private.broadcast_complaint(uuid, text),
  private.on_complaint_change(),
  private.request_triage(),
  private.reset_complaint_sla(uuid, timestamptz),
  private.escalate_complaint(uuid, integer, timestamptz),
  private.check_triage(uuid, integer, timestamptz)
  from public, anon, authenticated;
-- RLS-free helper the console RPCs and policies call as the signed-in user.
revoke all on function private.can_see_complaint(uuid) from public, anon;
grant execute on function private.can_see_complaint(uuid) to authenticated;

revoke all on function
  public.triage_preview(text),
  public.create_complaint(text, text, timestamptz, numeric, numeric, numeric, boolean, uuid, uuid),
  public.share_complaint_identity(uuid),
  public.complaint_timeline(uuid),
  public.claim_triage(integer),
  public.finish_triage(uuid, text, jsonb, text, boolean)
  from public, anon;
grant execute on function
  public.triage_preview(text),
  public.create_complaint(text, text, timestamptz, numeric, numeric, numeric, boolean, uuid, uuid),
  public.share_complaint_identity(uuid),
  public.complaint_timeline(uuid)
  to authenticated, service_role;
revoke all on function
  public.claim_triage(integer),
  public.finish_triage(uuid, text, jsonb, text, boolean)
  from authenticated;
grant execute on function
  public.claim_triage(integer),
  public.finish_triage(uuid, text, jsonb, text, boolean)
  to service_role;
