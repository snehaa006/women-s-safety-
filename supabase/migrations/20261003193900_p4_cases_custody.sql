-- Phase 4, step 3: cases, the workflow engine, officer signatures, the two-signature lock and
-- the custody hand-off handshake.

-- =============================================================================================
-- Signatures
-- =============================================================================================

-- Signs a material string with the user's server-held key (created on first use). Returns the
-- SHA-256 of the material, the HMAC-SHA256 signature over it and the key's fingerprint.
create function private.sign(p_user uuid, p_material text)
returns table (payload_sha256 text, signature text, key_fingerprint text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key private.signing_keys;
  v_secret bytea;
begin
  select * into v_key from private.signing_keys where user_id = p_user;
  if not found then
    v_secret := extensions.gen_random_bytes(32);
    insert into private.signing_keys (user_id, secret, fingerprint)
    values (p_user, v_secret,
            'k1:' || left(encode(extensions.digest(v_secret, 'sha256'), 'hex'), 16))
    on conflict (user_id) do nothing;
    select * into v_key from private.signing_keys where user_id = p_user;
  end if;
  payload_sha256 := encode(extensions.digest(p_material, 'sha256'), 'hex');
  signature := encode(extensions.hmac(convert_to(payload_sha256, 'UTF8'), v_key.secret, 'sha256'), 'hex');
  key_fingerprint := v_key.fingerprint;
  return next;
end;
$$;

-- Re-checks a stored signature against the signer's key and its material.
create function private.signature_valid(p_sig public.evidence_signatures)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_sig.payload_sha256 = encode(extensions.digest(p_sig.material, 'sha256'), 'hex')
       and p_sig.signature = encode(extensions.hmac(convert_to(p_sig.payload_sha256, 'UTF8'), k.secret, 'sha256'), 'hex')
       and p_sig.key_fingerprint = k.fingerprint
    from private.signing_keys k where k.user_id = p_sig.signer_id
  ), false)
$$;

create function private.add_signature(
  p_case_id     uuid,
  p_evidence_id uuid,
  p_capacity    text,
  p_purpose     text,
  p_transfer_id uuid default null
)
returns public.evidence_signatures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_sha      text;
  v_material text;
  v_signed   record;
  v_sig      public.evidence_signatures;
  v_now      timestamptz := date_trunc('milliseconds', now());
begin
  select sha256 into v_sha from public.evidence_items where id = p_evidence_id;
  v_material := concat_ws('|', p_purpose, p_case_id, p_evidence_id, v_sha, p_capacity, v_uid,
                          coalesce(p_transfer_id::text, ''),
                          to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  select * into v_signed from private.sign(v_uid, v_material);
  insert into public.evidence_signatures (
    case_id, evidence_id, signer_id, capacity, purpose, transfer_id, material, payload_sha256,
    signature, key_fingerprint, signed_at
  ) values (
    p_case_id, p_evidence_id, v_uid, p_capacity, p_purpose, p_transfer_id, v_material,
    v_signed.payload_sha256, v_signed.signature, v_signed.key_fingerprint, v_now
  )
  returning * into v_sig;
  return v_sig;
end;
$$;

-- =============================================================================================
-- The workflow engine
-- =============================================================================================

create function private.requirement_met(p_case_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'evidence_sealed' then exists (
      select 1 from public.case_evidence ce
      join public.evidence_items e on e.id = ce.evidence_id
      where ce.case_id = p_case_id and e.status = 'sealed')
    when 'site_visit' then exists (
      select 1 from public.case_events v
      where v.case_id = p_case_id and v.kind = 'site_visit' and v.within_geofence)
    when 'statement' then exists (
      select 1 from public.case_events v where v.case_id = p_case_id and v.kind = 'statement')
    when 'evidence_locked' then
      exists (select 1 from public.case_evidence ce
              join public.evidence_items e on e.id = ce.evidence_id
              where ce.case_id = p_case_id and e.status = 'sealed')
      and not exists (select 1 from public.case_evidence ce
                      join public.evidence_items e on e.id = ce.evidence_id
                      where ce.case_id = p_case_id and e.status = 'sealed' and ce.locked_at is null)
    when 'custody_complete' then not exists (
      select 1 from public.custody_transfers t
      where t.case_id = p_case_id and t.status in ('pending', 'accepted', 'mismatch')
        and not exists (select 1 from public.custody_transfers later
                        where later.case_id = t.case_id and later.evidence_id = t.evidence_id
                          and later.initiated_at > t.initiated_at and later.status = 'completed'))
    else false
  end
$$;

-- The case's workflow with each state's requirements and whether they are met now.
create function private.case_states(p_case public.cases)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', s.value ->> 'key',
           'label', s.value ->> 'label',
           'index', s.ordinality - 1,
           'requires', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'kind', r.kind, 'label', r.label, 'hint', r.hint,
                      'met', private.requirement_met(p_case.id, r.kind)) order by q.ordinality)
             from jsonb_array_elements_text(s.value -> 'requires') with ordinality q(kind, ordinality)
             join private.workflow_requirements r on r.kind = q.kind
           ), '[]'::jsonb)) order by s.ordinality), '[]'::jsonb)
  from public.workflow_definitions w,
       jsonb_array_elements(w.states) with ordinality s(value, ordinality)
  where w.id = p_case.workflow_id
$$;

create function private.case_for_action(p_case_id uuid)
returns public.cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
begin
  if not private.can_see_case(p_case_id) then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.status <> 'open' then
    raise exception 'This case is closed' using errcode = 'check_violation';
  end if;
  return v_case;
end;
$$;

-- Opens a case for a complaint or an SOS the officer can see. The officer leads it.
create function public.open_case(
  p_title        text,
  p_complaint_id uuid default null,
  p_incident_id  uuid default null,
  p_workflow_key text default 'standard'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_existing  public.cases;
  v_workflow  public.workflow_definitions;
  v_org       uuid;
  v_lat       numeric;
  v_lng       numeric;
  v_case      public.cases;
  v_item      uuid;
begin
  if not private.has_role(array['officer', 'supervisor']::public.app_role[]) then
    raise exception 'Only officers and supervisors open cases' using errcode = 'insufficient_privilege';
  end if;
  if (p_complaint_id is null) = (p_incident_id is null) then
    raise exception 'Open a case for one complaint or one SOS' using errcode = 'invalid_parameter_value';
  end if;
  if p_complaint_id is not null then
    if not private.can_see_complaint(p_complaint_id) then
      raise exception 'No such complaint' using errcode = 'no_data_found';
    end if;
    select * into v_existing from public.cases where complaint_id = p_complaint_id and status = 'open';
    if found then
      return jsonb_build_object('case_id', v_existing.id, 'reference', v_existing.reference,
                                'created', false);
    end if;
    select assigned_org_id, lat, lng into v_org, v_lat, v_lng
    from public.complaints where id = p_complaint_id;
  else
    if not private.can_see_incident(p_incident_id) then
      raise exception 'No such SOS' using errcode = 'no_data_found';
    end if;
    select * into v_existing from public.cases where incident_id = p_incident_id and status = 'open';
    if found then
      return jsonb_build_object('case_id', v_existing.id, 'reference', v_existing.reference,
                                'created', false);
    end if;
    select assigned_org_id, last_lat, last_lng into v_org, v_lat, v_lng
    from public.incidents where id = p_incident_id;
  end if;
  select * into v_workflow from public.workflow_definitions
  where key = coalesce(p_workflow_key, 'standard')
  order by version desc limit 1;
  if not found then
    raise exception 'No such workflow' using errcode = 'no_data_found';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then
    raise exception 'Give the case a title' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.cases (
    reference, title, org_id, complaint_id, incident_id, workflow_id, state, lead_officer_id,
    lat, lng, created_by
  ) values (
    'K-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.case_ref_seq')::text, 6, '0'),
    left(btrim(p_title), 200), coalesce(v_org, private.default_org()), p_complaint_id, p_incident_id,
    v_workflow.id, v_workflow.states -> 0 ->> 'key', v_uid, v_lat, v_lng, v_uid
  )
  returning * into v_case;

  perform private.ledger_append(
    p_action       => 'case.opened',
    p_subject_type => 'case',
    p_subject_id   => v_case.id,
    p_payload      => jsonb_build_object('reference', v_case.reference, 'complaint', p_complaint_id,
                                         'incident', p_incident_id, 'org', v_case.org_id,
                                         'workflow', v_workflow.key, 'version', v_workflow.version,
                                         'state', v_case.state)
  );

  for v_item in
    select id from public.evidence_items
    where status <> 'deleted' and shared_at is not null
      and ((p_complaint_id is not null and complaint_id = p_complaint_id)
        or (p_incident_id is not null and incident_id = p_incident_id))
    order by created_at
  loop
    perform private.attach_evidence(v_case.id, v_item, v_uid);
  end loop;

  return jsonb_build_object('case_id', v_case.id, 'reference', v_case.reference, 'created', true);
end;
$$;

-- A note or the complainant's statement.
create function public.add_case_note(p_case_id uuid, p_kind text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case  public.cases := private.case_for_action(p_case_id);
  v_body  text := btrim(coalesce(p_body, ''));
  v_event public.case_events;
begin
  if p_kind not in ('note', 'statement') then
    raise exception 'Unknown note kind' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_body) < 3 or char_length(v_body) > 4000 then
    raise exception 'Write between 3 and 4000 characters' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.case_events (case_id, kind, body, author_id)
  values (v_case.id, p_kind, v_body, auth.uid())
  returning * into v_event;
  perform private.ledger_append(
    p_action       => 'case.' || p_kind || '_added',
    p_subject_type => 'case',
    p_subject_id   => v_case.id,
    p_payload      => jsonb_build_object('event', v_event.id,
                                         'body_sha256', encode(extensions.digest(v_body, 'sha256'), 'hex'))
  );
  return jsonb_build_object('event_id', v_event.id);
end;
$$;

-- A site visit, checked against the case location (within 200 m).
create function public.case_checkin(
  p_case_id    uuid,
  p_lat        numeric,
  p_lng        numeric,
  p_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case     public.cases := private.case_for_action(p_case_id);
  v_distance numeric;
  v_within   boolean;
begin
  if p_lat is null or p_lng is null then
    raise exception 'Turn on location to check in' using errcode = 'invalid_parameter_value';
  end if;
  if v_case.lat is null then
    raise exception 'This case has no site location' using errcode = 'check_violation';
  end if;
  v_distance := round(extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(v_case.lng::float8, v_case.lat::float8), 4326)::extensions.geography
  )::numeric, 1);
  v_within := v_distance <= 200;
  insert into public.case_events (case_id, kind, lat, lng, accuracy_m, distance_m, within_geofence, author_id)
  values (v_case.id, 'site_visit', p_lat, p_lng, p_accuracy_m, v_distance, v_within, auth.uid());
  perform private.ledger_append(
    p_action       => 'case.site_checkin',
    p_subject_type => 'case',
    p_subject_id   => v_case.id,
    p_payload      => jsonb_build_object('distance_m', v_distance, 'within_geofence', v_within),
    p_lat          => p_lat,
    p_lng          => p_lng,
    p_accuracy_m   => p_accuracy_m
  );
  return jsonb_build_object('distance_m', v_distance, 'within_geofence', v_within);
end;
$$;

-- Moves the case forward. Every requirement of every state up to the target must be met;
-- otherwise nothing changes and the missing requirements come back (and the attempt is ledgered).
create function public.advance_case(p_case_id uuid, p_to_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case    public.cases := private.case_for_action(p_case_id);
  v_states  jsonb := private.case_states(v_case);
  v_from    integer;
  v_to      integer;
  v_missing jsonb;
begin
  select (s ->> 'index')::integer into v_from from jsonb_array_elements(v_states) s
  where s ->> 'key' = v_case.state;
  select (s ->> 'index')::integer into v_to from jsonb_array_elements(v_states) s
  where s ->> 'key' = p_to_state;
  if v_to is null then
    raise exception 'No such step in this workflow' using errcode = 'invalid_parameter_value';
  end if;
  if v_to <= v_from then
    raise exception 'A case only moves forward' using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'state', s ->> 'key', 'state_label', s ->> 'label',
           'kind', r ->> 'kind', 'label', r ->> 'label', 'hint', r ->> 'hint')
           order by (s ->> 'index')::integer), '[]'::jsonb)
    into v_missing
  from jsonb_array_elements(v_states) s, jsonb_array_elements(s -> 'requires') r
  where (s ->> 'index')::integer between v_from + 1 and v_to
    and not (r ->> 'met')::boolean;

  if jsonb_array_length(v_missing) > 0 then
    perform private.ledger_append(
      p_action       => 'case.advance_blocked',
      p_subject_type => 'case',
      p_subject_id   => v_case.id,
      p_payload      => jsonb_build_object('from', v_case.state, 'to', p_to_state,
                                           'missing', (select jsonb_agg(m ->> 'kind')
                                                       from jsonb_array_elements(v_missing) m))
    );
    return jsonb_build_object('ok', false, 'state', v_case.state, 'missing', v_missing);
  end if;

  update public.cases set state = p_to_state where id = v_case.id;
  perform private.ledger_append(
    p_action       => 'case.state_changed',
    p_subject_type => 'case',
    p_subject_id   => v_case.id,
    p_payload      => jsonb_build_object('from', v_case.state, 'to', p_to_state,
                                         'skipped', v_to - v_from - 1)
  );
  return jsonb_build_object('ok', true, 'state', p_to_state, 'missing', '[]'::jsonb);
end;
$$;

-- =============================================================================================
-- Lock and custody
-- =============================================================================================

-- The investigating officer and a supervisor each sign; the second signature locks the item.
create function public.sign_evidence_lock(p_case_id uuid, p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_case     public.cases := private.case_for_action(p_case_id);
  v_link     public.case_evidence;
  v_capacity text;
  v_sig      public.evidence_signatures;
  v_signed   text[];
begin
  select * into v_link from public.case_evidence
  where case_id = p_case_id and evidence_id = p_evidence_id for update;
  if not found then
    raise exception 'This item is not on the case' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.evidence_items where id = p_evidence_id and status = 'sealed') then
    raise exception 'Only sealed evidence can be locked' using errcode = 'check_violation';
  end if;
  if v_link.locked_at is not null then
    raise exception 'Already locked' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.evidence_signatures
             where case_id = p_case_id and evidence_id = p_evidence_id and purpose = 'lock'
               and signer_id = v_uid) then
    raise exception 'You already signed; the other signature must come from someone else'
      using errcode = 'check_violation';
  end if;

  v_capacity := case
    when v_uid = v_case.lead_officer_id then 'investigating_officer'
    when private.is_case_supervisor(p_case_id, v_uid) then 'supervisor'
  end;
  if v_capacity is null then
    raise exception 'Only the investigating officer or a supervisor can sign'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.evidence_signatures
             where case_id = p_case_id and evidence_id = p_evidence_id and purpose = 'lock'
               and capacity = v_capacity) then
    raise exception 'The % has already signed', replace(v_capacity, '_', ' ')
      using errcode = 'check_violation';
  end if;

  v_sig := private.add_signature(p_case_id, p_evidence_id, v_capacity, 'lock');
  perform private.ledger_append(
    p_action       => 'evidence.lock_signed',
    p_subject_type => 'evidence',
    p_subject_id   => p_evidence_id,
    p_payload      => jsonb_build_object('case', p_case_id, 'capacity', v_capacity,
                                         'payload_sha256', v_sig.payload_sha256,
                                         'signature', v_sig.signature, 'key', v_sig.key_fingerprint)
  );

  select array_agg(capacity order by capacity) into v_signed from public.evidence_signatures
  where case_id = p_case_id and evidence_id = p_evidence_id and purpose = 'lock';
  if v_signed @> array['investigating_officer', 'supervisor'] then
    update public.case_evidence set locked_at = now()
     where case_id = p_case_id and evidence_id = p_evidence_id;
    perform private.ledger_append(
      p_action       => 'evidence.locked',
      p_subject_type => 'evidence',
      p_subject_id   => p_evidence_id,
      p_payload      => jsonb_build_object('case', p_case_id, 'signatures', 2)
    );
  end if;
  return jsonb_build_object('capacity', v_capacity, 'signed', to_jsonb(v_signed),
                            'locked', v_signed @> array['investigating_officer', 'supervisor']);
end;
$$;

-- Staff who may hold a case's evidence: officers and supervisors of its station and above.
create function private.case_staff(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), 'Staff member'),
           'role', p.role)), '[]'::jsonb)
  from public.cases k
  join public.memberships m on m.org_id = k.org_id or m.org_id in (select private.org_ancestors(k.org_id))
  join public.profiles p on p.id = m.user_id and p.role in ('officer', 'supervisor')
  where k.id = p_case_id
$$;

-- The custodian starts a hand-off and signs as sender.
create function public.start_custody_transfer(
  p_case_id     uuid,
  p_evidence_id uuid,
  p_to_user     uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_case     public.cases := private.case_for_action(p_case_id);
  v_link     public.case_evidence;
  v_transfer public.custody_transfers;
  v_sig      public.evidence_signatures;
begin
  select * into v_link from public.case_evidence
  where case_id = p_case_id and evidence_id = p_evidence_id for update;
  if not found then
    raise exception 'This item is not on the case' using errcode = 'no_data_found';
  end if;
  if v_link.custodian_id is distinct from v_uid then
    raise exception 'Only the current custodian can hand it over' using errcode = 'insufficient_privilege';
  end if;
  if p_to_user = v_uid or not exists (
    select 1 from jsonb_array_elements(private.case_staff(p_case_id)) s
    where (s ->> 'id')::uuid = p_to_user) then
    raise exception 'Choose another officer on this case' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for the hand-off' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.custody_transfers
             where case_id = p_case_id and evidence_id = p_evidence_id
               and status in ('pending', 'accepted')) then
    raise exception 'A hand-off is already in progress' using errcode = 'check_violation';
  end if;

  insert into public.custody_transfers (case_id, evidence_id, from_user, to_user, reason)
  values (p_case_id, p_evidence_id, v_uid, p_to_user, btrim(p_reason))
  returning * into v_transfer;
  v_sig := private.add_signature(p_case_id, p_evidence_id, 'sender', 'transfer_send', v_transfer.id);
  perform private.ledger_append(
    p_action       => 'custody.transfer_started',
    p_subject_type => 'evidence',
    p_subject_id   => p_evidence_id,
    p_payload      => jsonb_build_object('transfer', v_transfer.id, 'case', p_case_id,
                                         'from', v_uid, 'to', p_to_user, 'reason', v_transfer.reason,
                                         'signature', v_sig.signature, 'key', v_sig.key_fingerprint)
  );
  return jsonb_build_object('transfer_id', v_transfer.id);
end;
$$;

-- The receiver accepts (signs, and the file is re-hashed) or declines; the sender may cancel.
create function public.respond_custody_transfer(p_transfer_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_transfer public.custody_transfers;
  v_sig      public.evidence_signatures;
begin
  select * into v_transfer from public.custody_transfers where id = p_transfer_id for update;
  if not found or not private.can_see_case(v_transfer.case_id) then
    raise exception 'No such hand-off' using errcode = 'no_data_found';
  end if;
  if v_transfer.status <> 'pending' then
    raise exception 'This hand-off is no longer waiting' using errcode = 'check_violation';
  end if;
  perform private.case_for_action(v_transfer.case_id);

  if p_decision in ('accept', 'decline') and v_uid is distinct from v_transfer.to_user then
    raise exception 'Only the receiving officer can answer' using errcode = 'insufficient_privilege';
  end if;
  if p_decision = 'cancel' and v_uid is distinct from v_transfer.from_user then
    raise exception 'Only the sender can cancel' using errcode = 'insufficient_privilege';
  end if;

  if p_decision = 'accept' then
    update public.custody_transfers set status = 'accepted', accepted_at = now() where id = p_transfer_id;
    v_sig := private.add_signature(v_transfer.case_id, v_transfer.evidence_id, 'receiver',
                                   'transfer_accept', p_transfer_id);
    perform private.ledger_append(
      p_action       => 'custody.transfer_accepted',
      p_subject_type => 'evidence',
      p_subject_id   => v_transfer.evidence_id,
      p_payload      => jsonb_build_object('transfer', p_transfer_id, 'case', v_transfer.case_id,
                                           'signature', v_sig.signature, 'key', v_sig.key_fingerprint)
    );
    perform private.queue_evidence_check(v_transfer.evidence_id, 'transfer', p_transfer_id);
    return jsonb_build_object('status', 'accepted');
  elsif p_decision in ('decline', 'cancel') then
    update public.custody_transfers
       set status = case p_decision when 'decline' then 'declined' else 'cancelled' end,
           completed_at = now()
     where id = p_transfer_id;
    perform private.ledger_append(
      p_action       => case p_decision when 'decline' then 'custody.transfer_declined'
                                        else 'custody.transfer_cancelled' end,
      p_subject_type => 'evidence',
      p_subject_id   => v_transfer.evidence_id,
      p_payload      => jsonb_build_object('transfer', p_transfer_id, 'case', v_transfer.case_id)
    );
    return jsonb_build_object('status', case p_decision when 'decline' then 'declined' else 'cancelled' end);
  end if;
  raise exception 'Answer accept, decline or cancel' using errcode = 'invalid_parameter_value';
end;
$$;

-- =============================================================================================
-- Workflow administration
-- =============================================================================================

create function public.console_workflows()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workflows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'key', w.key, 'version', w.version, 'name', w.name, 'states', w.states,
               'created_at', w.created_at,
               'open_cases', (select count(*) from public.cases k
                              where k.workflow_id = w.id and k.status = 'open')) order by w.key)
      from public.workflow_definitions w
      where w.version = (select max(v.version) from public.workflow_definitions v where v.key = w.key)
    ), '[]'::jsonb),
    'requirements', (select jsonb_agg(jsonb_build_object('kind', r.kind, 'label', r.label,
                                                         'hint', r.hint) order by r.kind)
                     from private.workflow_requirements r))
  where private.has_role(array['officer', 'supervisor', 'oversight', 'admin']::public.app_role[])
$$;

-- Saves a new version of a workflow. Open cases keep the version they started with.
create function public.admin_save_workflow(p_key text, p_name text, p_states jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state    jsonb;
  v_keys     text[] := '{}';
  v_version  integer;
  v_workflow public.workflow_definitions;
  v_clean    jsonb := '[]'::jsonb;
begin
  if not private.has_role(array['admin']::public.app_role[]) then
    raise exception 'Only admins edit workflows' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_key, '') !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'The key uses lowercase letters, digits and _' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_states) <> 'array' or jsonb_array_length(p_states) not between 2 and 15 then
    raise exception 'A workflow has 2 to 15 steps' using errcode = 'invalid_parameter_value';
  end if;
  for v_state in select value from jsonb_array_elements(p_states) loop
    if coalesce(v_state ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,40}$' or (v_state ->> 'key') = any (v_keys) then
      raise exception 'Each step needs a unique key (lowercase letters, digits and _)'
        using errcode = 'invalid_parameter_value';
    end if;
    if char_length(btrim(coalesce(v_state ->> 'label', ''))) not between 1 and 60 then
      raise exception 'Each step needs a label' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(coalesce(v_state -> 'requires', '[]'::jsonb)) <> 'array'
       or exists (select 1 from jsonb_array_elements_text(coalesce(v_state -> 'requires', '[]'::jsonb)) q(kind)
                  where q.kind not in (select kind from private.workflow_requirements)) then
      raise exception 'Unknown requirement in step %', v_state ->> 'key'
        using errcode = 'invalid_parameter_value';
    end if;
    v_keys := v_keys || (v_state ->> 'key');
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'key', v_state ->> 'key', 'label', btrim(v_state ->> 'label'),
      'requires', coalesce((select jsonb_agg(distinct q.kind)
                            from jsonb_array_elements_text(coalesce(v_state -> 'requires', '[]'::jsonb)) q(kind)),
                           '[]'::jsonb)));
  end loop;

  select coalesce(max(version), 0) + 1 into v_version from public.workflow_definitions where key = p_key;
  insert into public.workflow_definitions (key, version, name, states, created_by)
  values (p_key, v_version, btrim(p_name), v_clean, auth.uid())
  returning * into v_workflow;
  perform private.ledger_append(
    p_action       => 'workflow.saved',
    p_subject_type => 'workflow',
    p_subject_id   => v_workflow.id,
    p_payload      => jsonb_build_object('key', p_key, 'version', v_version, 'states', v_clean)
  );
  return jsonb_build_object('workflow_id', v_workflow.id, 'version', v_version);
end;
$$;
