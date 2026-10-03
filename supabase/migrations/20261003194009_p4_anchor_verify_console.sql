-- Phase 4, step 4: ledger anchoring (Merkle roots stamped by OpenTimestamps), the public
-- verifier, the console reads for cases and evidence, the new job kinds and privileges.

-- =============================================================================================
-- Merkle roots and proofs
-- =============================================================================================

-- The Merkle root over the entry hashes of ledger entries p_from..p_to (in seq order), and the
-- proof for p_seq when given. A parent is SHA-256(left || right) over the raw 32-byte hashes; an
-- odd node is paired with itself. A proof step says on which side the sibling sits.
create function private.merkle(p_from bigint, p_to bigint, p_seq bigint default null)
returns table (root text, proof jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level bytea[];
  v_next  bytea[];
  v_seqs  bigint[];
  v_idx   integer;
  v_proof jsonb := '[]'::jsonb;
  v_n     integer;
  v_i     integer;
begin
  select array_agg(decode(e.entry_hash, 'hex') order by e.seq), array_agg(e.seq order by e.seq)
    into v_level, v_seqs
  from public.ledger_entries e
  where e.seq between p_from and p_to;
  if v_level is null then
    return;
  end if;
  v_idx := array_position(v_seqs, p_seq);

  while array_length(v_level, 1) > 1 loop
    v_n := array_length(v_level, 1);
    v_next := '{}';
    v_i := 1;
    while v_i <= v_n loop
      v_next := v_next || extensions.digest(v_level[v_i] || coalesce(v_level[v_i + 1], v_level[v_i]), 'sha256');
      v_i := v_i + 2;
    end loop;
    if v_idx is not null then
      if v_idx % 2 = 1 then
        v_proof := v_proof || jsonb_build_array(jsonb_build_object(
          'side', 'right', 'hash', encode(coalesce(v_level[v_idx + 1], v_level[v_idx]), 'hex')));
      else
        v_proof := v_proof || jsonb_build_array(jsonb_build_object(
          'side', 'left', 'hash', encode(v_level[v_idx - 1], 'hex')));
      end if;
      v_idx := (v_idx + 1) / 2;
    end if;
    v_level := v_next;
  end loop;

  root := encode(v_level[1], 'hex');
  proof := case when p_seq is null then null else v_proof end;
  return next;
end;
$$;

-- Every 10 minutes (Supabase Cron): one anchor over the entries since the last one, at most
-- 5,000 per anchor, then the `anchor` function stamps the roots.
create function private.anchor_ledger(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from bigint;
  v_last bigint;
  v_to   bigint;
  v_root text;
begin
  perform pg_advisory_xact_lock(hashtext('public.ledger_anchors'));
  select coalesce(max(to_seq), 0) + 1 into v_from from public.ledger_anchors;
  select max(seq) into v_last from public.ledger_entries;
  if v_last is not null and v_last >= v_from then
    v_to := least(v_last, v_from + 4999);
    select m.root into v_root from private.merkle(v_from, v_to) m;
    insert into public.ledger_anchors (from_seq, to_seq, leaf_count, merkle_root, created_at)
    values (v_from, v_to, (v_to - v_from + 1)::integer, v_root, p_now);
  end if;
  if exists (select 1 from public.ledger_anchors
             where ots_status = 'pending'
                or (ots_status = 'claimed' and claimed_at < p_now - interval '5 minutes')) then
    perform private.request_function('anchor');
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'root', v_root);
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ledger-anchor', '*/10 * * * *', 'select private.anchor_ledger()');
  end if;
end
$$;

-- The `anchor` function's queue (service role only).
create function public.claim_anchors(p_limit integer default 5)
returns table (anchor_id uuid, merkle_root text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.ledger_anchors a
     set ots_status = 'claimed', claimed_at = now(), attempts = a.attempts + 1
   where a.id in (
     select w.id from public.ledger_anchors w
     where w.ots_status = 'pending'
        or (w.ots_status = 'claimed' and w.claimed_at < now() - interval '5 minutes')
     order by w.from_seq
     limit least(greatest(p_limit, 1), 20)
     for update skip locked
   )
  returning a.id, a.merkle_root;
end;
$$;

create function public.finish_anchor(
  p_anchor_id uuid,
  p_calendar  text default null,
  p_receipt   text default null,
  p_error     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_receipt is not null then
    update public.ledger_anchors
       set ots_status = 'submitted', ots_calendar = left(p_calendar, 200),
           ots_receipt = left(p_receipt, 20000), submitted_at = now(), last_error = null
     where id = p_anchor_id and ots_status = 'claimed';
  else
    update public.ledger_anchors
       set ots_status = case when attempts >= 5 then 'failed' else 'pending' end,
           last_error = left(coalesce(p_error, 'No receipt'), 300)
     where id = p_anchor_id and ots_status = 'claimed';
  end if;
end;
$$;

-- The anchor covering a ledger entry, with the entry's Merkle proof.
create function private.anchor_for(p_seq bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'from_seq', a.from_seq, 'to_seq', a.to_seq, 'leaf_count', a.leaf_count,
    'merkle_root', a.merkle_root, 'created_at', a.created_at, 'ots_status', a.ots_status,
    'ots_calendar', a.ots_calendar, 'submitted_at', a.submitted_at, 'receipt', a.ots_receipt,
    'proof', (select m.proof from private.merkle(a.from_seq, a.to_seq, p_seq) m))
  from public.ledger_anchors a
  where p_seq between a.from_seq and a.to_seq
$$;

-- =============================================================================================
-- The public verifier
-- =============================================================================================

-- Anyone may ask whether a file (by its SHA-256, computed on their device) was sealed. The answer
-- holds no personal data: the sealing entry is written by the system without a person or place,
-- so its fields can be shown in full and every hash re-checked in the browser.
create function public.verify_evidence(p_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sha   text := lower(btrim(coalesce(p_sha256, '')));
  v_item  public.evidence_items;
  v_entry public.ledger_entries;
begin
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'A SHA-256 is 64 hexadecimal characters' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_item from public.evidence_items
  where sha256 = v_sha and sealed_seq is not null
  order by sealed_at
  limit 1;
  if not found then
    return jsonb_build_object('found', false, 'sha256', v_sha);
  end if;
  select * into v_entry from public.ledger_entries where seq = v_item.sealed_seq;

  return jsonb_build_object(
    'found', true,
    'sha256', v_item.sha256,
    'size_bytes', v_item.size_bytes,
    'mime_type', v_item.mime_type,
    'registered_at', v_item.created_at,
    'sealed_at', v_item.sealed_at,
    'deleted_at', v_item.deleted_at,
    'copies', (select count(*) from public.evidence_items
               where sha256 = v_sha and sealed_seq is not null),
    'entry', jsonb_build_object(
      'seq', v_entry.seq, 'action', v_entry.action, 'occurred_at', v_entry.occurred_at,
      'recorded_at', v_entry.recorded_at, 'payload_text', v_entry.payload::text,
      'payload_hash', v_entry.payload_hash, 'prev_hash', v_entry.prev_hash,
      'entry_hash', v_entry.entry_hash, 'material', private.ledger_entry_material(v_entry)),
    'anchor', private.anchor_for(v_entry.seq)
  );
end;
$$;

-- =============================================================================================
-- Console reads
-- =============================================================================================

-- ✓ captured, ✓ hashed, ✓ sealed, ✓ signed, ✓ custody, ✓ anchored, or what is missing.
create function private.evidence_checklist(p_case_id uuid, p_evidence_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with x as (
    select e.*, ce.locked_at, ce.custodian_id,
           (select count(*) from public.evidence_signatures s
            where s.case_id = ce.case_id and s.evidence_id = ce.evidence_id
              and s.purpose = 'lock') as lock_signatures,
           exists (select 1 from public.custody_transfers t
                   where t.case_id = ce.case_id and t.evidence_id = ce.evidence_id
                     and t.status in ('pending', 'accepted', 'mismatch')
                     and not exists (select 1 from public.custody_transfers l
                                     where l.case_id = t.case_id and l.evidence_id = t.evidence_id
                                       and l.initiated_at > t.initiated_at
                                       and l.status = 'completed')) as custody_open,
           exists (select 1 from public.ledger_anchors a
                   where e.sealed_seq between a.from_seq and a.to_seq
                     and a.ots_status = 'submitted') as anchored
    from public.case_evidence ce
    join public.evidence_items e on e.id = ce.evidence_id
    where ce.case_id = p_case_id and ce.evidence_id = p_evidence_id
  ), steps as (
    select jsonb_build_array(
      jsonb_build_object('step', 'captured', 'label', 'Captured', 'done', true),
      jsonb_build_object('step', 'hashed', 'label', 'Hashed on device', 'done', x.sha256 is not null),
      jsonb_build_object('step', 'sealed', 'label', 'Sealed (server re-hash)', 'done', x.status = 'sealed'),
      jsonb_build_object('step', 'signed', 'label', 'Signed and locked', 'done', x.locked_at is not null,
                         'detail', x.lock_signatures || ' of 2 signatures'),
      jsonb_build_object('step', 'custody', 'label', 'Custody clear',
                         'done', x.custodian_id is not null and not x.custody_open),
      jsonb_build_object('step', 'anchored', 'label', 'Anchored (OpenTimestamps)', 'done', x.anchored)
    ) as list
    from x
  )
  select jsonb_build_object(
    'steps', steps.list,
    'missing', coalesce((select jsonb_agg(s ->> 'label') from jsonb_array_elements(steps.list) s
                         where not (s ->> 'done')::boolean), '[]'::jsonb))
  from steps
$$;

create function private.case_row(p_case public.cases)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_case.id,
    'reference', p_case.reference,
    'title', p_case.title,
    'status', p_case.status,
    'state', p_case.state,
    'state_label', (select s ->> 'label' from public.workflow_definitions w,
                    jsonb_array_elements(w.states) s
                    where w.id = p_case.workflow_id and s ->> 'key' = p_case.state),
    'state_index', (select s.ordinality - 1 from public.workflow_definitions w,
                    jsonb_array_elements(w.states) with ordinality s(value, ordinality)
                    where w.id = p_case.workflow_id and s.value ->> 'key' = p_case.state),
    'state_count', (select jsonb_array_length(w.states) from public.workflow_definitions w
                    where w.id = p_case.workflow_id),
    'org_id', p_case.org_id,
    'org_name', (select o.name from public.organizations o where o.id = p_case.org_id),
    'lead_officer', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                     from public.profiles p where p.id = p_case.lead_officer_id),
    'lead_officer_id', p_case.lead_officer_id,
    'complaint_id', p_case.complaint_id,
    'complaint_reference', (select c.reference from public.complaints c where c.id = p_case.complaint_id),
    'incident_id', p_case.incident_id,
    'evidence_count', (select count(*) from public.case_evidence ce where ce.case_id = p_case.id),
    'locked_count', (select count(*) from public.case_evidence ce
                     where ce.case_id = p_case.id and ce.locked_at is not null),
    'created_at', p_case.created_at,
    'updated_at', p_case.updated_at
  )
$$;

create function public.console_cases()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.case_row(k) order by k.status, k.updated_at desc), '[]'::jsonb)
  from public.cases k
  where private.can_see_case(k.id)
$$;

-- Who added an item, as officers may see it: a confidential reporter stays an alias.
create function private.evidence_added_by(p_case public.cases, p_item public.evidence_items)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.complaints c where c.id = p_case.complaint_id
                 and c.citizen_id = p_item.owner_id) then
      (select case when c.confidential and c.identity_shared_at is null then c.alias
                   else 'Complainant' end
       from public.complaints c where c.id = p_case.complaint_id)
    when exists (select 1 from public.incidents i where i.id = p_case.incident_id
                 and i.citizen_id = p_item.owner_id) then 'The person who raised the SOS'
    else coalesce((select nullif(btrim(p.full_name), '') from public.profiles p
                   where p.id = p_item.owner_id), 'Staff member')
  end
$$;

create function public.console_case(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_uid  uuid := auth.uid();
begin
  select * into v_case from public.cases where id = p_case_id;
  if not found or not private.can_see_case(p_case_id) then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;

  return private.case_row(v_case) || jsonb_build_object(
    'location', case when v_case.lat is null then null
                     else jsonb_build_object('lat', v_case.lat, 'lng', v_case.lng) end,
    'workflow', (select jsonb_build_object('key', w.key, 'version', w.version, 'name', w.name)
                 from public.workflow_definitions w where w.id = v_case.workflow_id),
    'states', private.case_states(v_case),
    'me', jsonb_build_object(
      'is_lead', v_uid = v_case.lead_officer_id,
      'is_supervisor', private.is_case_supervisor(p_case_id, v_uid)),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'file_name', e.file_name, 'kind', e.kind, 'mime_type', e.mime_type,
               'size_bytes', e.size_bytes, 'sha256', e.sha256, 'status', e.status,
               'captured_at', e.captured_at, 'sealed_at', e.sealed_at, 'locked_at', ce.locked_at,
               'added_at', ce.added_at, 'added_by', private.evidence_added_by(v_case, e),
               'custodian', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                             from public.profiles p where p.id = ce.custodian_id),
               'custodian_id', ce.custodian_id,
               'checklist', private.evidence_checklist(ce.case_id, ce.evidence_id))
             order by ce.added_at)
      from public.case_evidence ce
      join public.evidence_items e on e.id = ce.evidence_id
      where ce.case_id = p_case_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'kind', v.kind, 'body', v.body, 'distance_m', v.distance_m,
               'within_geofence', v.within_geofence, 'created_at', v.created_at,
               'author', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                          from public.profiles p where p.id = v.author_id)) order by v.created_at)
      from public.case_events v where v.case_id = p_case_id
    ), '[]'::jsonb),
    'staff', private.case_staff(p_case_id),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', e.seq, 'occurred_at', e.occurred_at, 'action', e.action,
               'actor_role', e.actor_role, 'payload', e.payload) order by e.seq)
      from public.ledger_entries e
      where e.subject_type = 'case' and e.subject_id = p_case_id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.console_evidence(p_case_id uuid, p_evidence_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_item public.evidence_items;
  v_link public.case_evidence;
  v_uid  uuid := auth.uid();
begin
  select * into v_case from public.cases where id = p_case_id;
  select * into v_link from public.case_evidence where case_id = p_case_id and evidence_id = p_evidence_id;
  if v_case.id is null or v_link.case_id is null or not private.can_see_case(p_case_id) then
    raise exception 'No such evidence' using errcode = 'no_data_found';
  end if;
  select * into v_item from public.evidence_items where id = p_evidence_id;

  return jsonb_build_object(
    'id', v_item.id,
    'case', private.case_row(v_case),
    'file_name', v_item.file_name,
    'kind', v_item.kind,
    'source', v_item.source,
    'mime_type', v_item.mime_type,
    'size_bytes', v_item.size_bytes,
    'sha256', v_item.sha256,
    'status', v_item.status,
    'reject_reason', v_item.reject_reason,
    'storage_path', case when v_item.status = 'deleted' then null else v_item.storage_path end,
    'captured_at', v_item.captured_at,
    'location', case when v_item.lat is null then null
                     else jsonb_build_object('lat', v_item.lat, 'lng', v_item.lng,
                                             'accuracy_m', v_item.accuracy_m) end,
    'note', v_item.note,
    'registered_at', v_item.created_at,
    'sealed_at', v_item.sealed_at,
    'sealed_seq', v_item.sealed_seq,
    'added_by', private.evidence_added_by(v_case, v_item),
    'locked_at', v_link.locked_at,
    'custodian', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                  from public.profiles p where p.id = v_link.custodian_id),
    'custodian_id', v_link.custodian_id,
    'checklist', private.evidence_checklist(p_case_id, p_evidence_id),
    'me', jsonb_build_object(
      'id', v_uid,
      'is_lead', v_uid = v_case.lead_officer_id,
      'is_supervisor', private.is_case_supervisor(p_case_id, v_uid),
      'is_custodian', v_uid = v_link.custodian_id),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'capacity', s.capacity, 'purpose', s.purpose, 'transfer_id', s.transfer_id,
               'signer', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                          from public.profiles p where p.id = s.signer_id),
               'payload_sha256', s.payload_sha256, 'signature', s.signature,
               'key_fingerprint', s.key_fingerprint, 'signed_at', s.signed_at,
               'valid', private.signature_valid(s)) order by s.signed_at)
      from public.evidence_signatures s
      where s.case_id = p_case_id and s.evidence_id = p_evidence_id
    ), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'status', t.status, 'reason', t.reason,
               'from_id', t.from_user, 'to_id', t.to_user,
               'from', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                        from public.profiles p where p.id = t.from_user),
               'to', (select coalesce(nullif(btrim(p.full_name), ''), 'Staff member')
                      from public.profiles p where p.id = t.to_user),
               'initiated_at', t.initiated_at, 'accepted_at', t.accepted_at,
               'completed_at', t.completed_at, 'rehash_sha256', t.rehash_sha256,
               'rehash_ok', t.rehash_ok) order by t.initiated_at)
      from public.custody_transfers t
      where t.case_id = p_case_id and t.evidence_id = p_evidence_id
    ), '[]'::jsonb),
    'staff', private.case_staff(p_case_id),
    'anchor', case when v_item.sealed_seq is null then null else private.anchor_for(v_item.sealed_seq) end,
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', e.seq, 'occurred_at', e.occurred_at, 'action', e.action,
               'actor_role', e.actor_role, 'payload', e.payload, 'entry_hash', e.entry_hash)
             order by e.seq)
      from public.ledger_entries e
      where e.subject_type = 'evidence' and e.subject_id = p_evidence_id
    ), '[]'::jsonb)
  );
end;
$$;

-- The citizen's own item: details, history and its anchor receipt once sealed.
create function public.vault_item(p_evidence_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.evidence_items;
begin
  select * into v_item from public.evidence_items where id = p_evidence_id and owner_id = auth.uid();
  if not found then
    raise exception 'No such evidence' using errcode = 'no_data_found';
  end if;
  return to_jsonb(v_item) - 'owner_id' - 'client_id' || jsonb_build_object(
    'complaint_reference', (select c.reference from public.complaints c where c.id = v_item.complaint_id),
    'on_case', exists (select 1 from public.case_evidence ce where ce.evidence_id = v_item.id),
    'anchor', case when v_item.sealed_seq is null then null else private.anchor_for(v_item.sealed_seq) end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
                                   'seq', t.seq, 'occurred_at', t.occurred_at, 'action', t.action,
                                   'payload', t.payload) order by t.seq)
                          from public.evidence_timeline(p_evidence_id) t), '[]'::jsonb)
  );
end;
$$;

-- =============================================================================================
-- Jobs
-- =============================================================================================

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
    when 'evidence.check' then
      perform private.check_evidence((p_payload ->> 'check_id')::uuid,
                                     (p_payload ->> 'try')::integer, p_now);
    when 'evidence.expire_upload' then
      perform private.expire_upload((p_payload ->> 'evidence_id')::uuid, p_now);
    when 'evidence.purge' then
      perform private.purge_evidence((p_payload ->> 'evidence_id')::uuid, p_now);
    else
      raise exception 'Unknown job kind %', p_kind;
  end case;
end;
$$;

-- =============================================================================================
-- Privileges
-- =============================================================================================

revoke all on function
  private.request_function(text),
  private.broadcast_case(uuid, text),
  private.on_evidence_change(),
  private.on_case_child_change(),
  private.attach_evidence(uuid, uuid, uuid),
  private.queue_evidence_check(uuid, text, uuid),
  private.fail_evidence_check(uuid, text),
  private.check_evidence(uuid, integer, timestamptz),
  private.expire_upload(uuid, timestamptz),
  private.purge_evidence(uuid, timestamptz),
  private.sign(uuid, text),
  private.signature_valid(public.evidence_signatures),
  private.add_signature(uuid, uuid, text, text, uuid),
  private.requirement_met(uuid, text),
  private.case_states(public.cases),
  private.case_for_action(uuid),
  private.case_staff(uuid),
  private.is_case_supervisor(uuid, uuid),
  private.merkle(bigint, bigint, bigint),
  private.anchor_ledger(timestamptz),
  private.anchor_for(bigint),
  private.evidence_checklist(uuid, uuid),
  private.case_row(public.cases),
  private.evidence_added_by(public.cases, public.evidence_items)
  from public, anon, authenticated;
-- Called by Storage's RLS as the signed-in user.
revoke all on function private.can_upload_evidence(text), private.can_read_evidence(text),
  private.can_see_case(uuid) from public, anon;
grant execute on function private.can_upload_evidence(text), private.can_read_evidence(text),
  private.can_see_case(uuid) to authenticated;

revoke all on function
  public.register_evidence(text, text, bigint, text, text, text, timestamptz, numeric, numeric, numeric, text, uuid, uuid),
  public.confirm_evidence_upload(uuid),
  public.share_evidence(uuid, uuid, uuid),
  public.request_evidence_deletion(uuid),
  public.cancel_evidence_deletion(uuid),
  public.evidence_timeline(uuid),
  public.vault_item(uuid),
  public.open_case(text, uuid, uuid, text),
  public.add_case_note(uuid, text, text),
  public.case_checkin(uuid, numeric, numeric, numeric),
  public.advance_case(uuid, text),
  public.sign_evidence_lock(uuid, uuid),
  public.start_custody_transfer(uuid, uuid, uuid, text),
  public.respond_custody_transfer(uuid, text),
  public.console_workflows(),
  public.admin_save_workflow(text, text, jsonb),
  public.console_cases(),
  public.console_case(uuid),
  public.console_evidence(uuid, uuid),
  public.claim_evidence_checks(integer),
  public.finish_evidence_check(uuid, text, bigint, text, boolean),
  public.claim_anchors(integer),
  public.finish_anchor(uuid, text, text, text),
  public.verify_evidence(text)
  from public, anon, authenticated;
grant execute on function
  public.register_evidence(text, text, bigint, text, text, text, timestamptz, numeric, numeric, numeric, text, uuid, uuid),
  public.confirm_evidence_upload(uuid),
  public.share_evidence(uuid, uuid, uuid),
  public.request_evidence_deletion(uuid),
  public.cancel_evidence_deletion(uuid),
  public.evidence_timeline(uuid),
  public.vault_item(uuid),
  public.open_case(text, uuid, uuid, text),
  public.add_case_note(uuid, text, text),
  public.case_checkin(uuid, numeric, numeric, numeric),
  public.advance_case(uuid, text),
  public.sign_evidence_lock(uuid, uuid),
  public.start_custody_transfer(uuid, uuid, uuid, text),
  public.respond_custody_transfer(uuid, text),
  public.console_workflows(),
  public.admin_save_workflow(text, text, jsonb),
  public.console_cases(),
  public.console_case(uuid),
  public.console_evidence(uuid, uuid)
  to authenticated, service_role;
grant execute on function
  public.claim_evidence_checks(integer),
  public.finish_evidence_check(uuid, text, bigint, text, boolean),
  public.claim_anchors(integer),
  public.finish_anchor(uuid, text, text, text)
  to service_role;
-- The verifier is public: it answers only about hashes someone already holds.
grant execute on function public.verify_evidence(text) to anon, authenticated, service_role;
