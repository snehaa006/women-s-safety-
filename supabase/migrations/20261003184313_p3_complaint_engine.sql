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
