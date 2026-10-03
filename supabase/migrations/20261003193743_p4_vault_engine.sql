-- Phase 4, step 2: the vault engine. Registering, uploading, sealing by server re-hash, sharing
-- with the police and delayed deletion.

-- =============================================================================================
-- Helpers
-- =============================================================================================

-- Asks an Edge Function to look at its queue (pg_net; a no-op without it, as in the tests).
create function private.request_function(p_name text)
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
    url                  => v_url || '/' || p_name,
    body                 => '{}'::jsonb,
    params               => '{}'::jsonb,
    headers              => '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds => 10000
  );
exception when others then
  raise warning 'Could not request the % function: %', p_name, sqlerrm;
end;
$$;

-- Admin and oversight see every case; members of the case's station, and of the organisations
-- above it, see its cases.
create function private.can_see_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['admin', 'oversight']::public.app_role[])
    or exists (
      select 1
      from public.cases k
      join public.memberships m on m.user_id = auth.uid()
      where k.id = p_case_id
        and private.has_role(array['officer', 'supervisor']::public.app_role[])
        and (m.org_id = k.org_id or m.org_id in (select private.org_ancestors(k.org_id)))
    )
$$;

-- Supervisors of the case's station or above (by membership role).
create function private.is_case_supervisor(p_case_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cases k
    join public.memberships m on m.user_id = p_user and m.role = 'supervisor'
    join public.profiles p on p.id = p_user and p.role in ('officer', 'supervisor')
    where k.id = p_case_id
      and (m.org_id = k.org_id or m.org_id in (select private.org_ancestors(k.org_id)))
  )
$$;

-- Pings the case's station and the organisations above it.
create function private.broadcast_case(p_case_id uuid, p_what text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_payload jsonb := jsonb_build_object('what', p_what, 'case', p_case_id);
begin
  select org_id into v_org from public.cases where id = p_case_id;
  if v_org is null then
    return;
  end if;
  begin
    for v_org in select v_org union select private.org_ancestors(v_org) loop
      perform realtime.send(v_payload, 'changed', 'org:' || v_org::text, true);
    end loop;
  exception when others then
    raise warning 'Live update for case % was not sent: %', p_case_id, sqlerrm;
  end;
end;
$$;

create function private.on_evidence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case uuid;
begin
  begin
    perform realtime.send(jsonb_build_object('what', 'evidence', 'evidence', new.id), 'changed',
                          'user:' || new.owner_id::text, true);
  exception when others then
    raise warning 'Live update for evidence % was not sent: %', new.id, sqlerrm;
  end;
  for v_case in select case_id from public.case_evidence where evidence_id = new.id loop
    perform private.broadcast_case(v_case, 'evidence');
  end loop;
  return null;
end;
$$;

create trigger evidence_items_broadcast
  after update on public.evidence_items
  for each row execute function private.on_evidence_change();

create function private.on_case_child_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- cases has no case_id column, so the child tables' value is read through jsonb.
  if tg_table_name = 'cases' then
    perform private.broadcast_case(new.id, 'cases');
  else
    perform private.broadcast_case((to_jsonb(new) ->> 'case_id')::uuid, tg_table_name);
  end if;
  return null;
end;
$$;

create trigger cases_broadcast
  after insert or update on public.cases
  for each row execute function private.on_case_child_change();
create trigger case_evidence_broadcast
  after insert or update on public.case_evidence
  for each row execute function private.on_case_child_change();
create trigger case_events_broadcast
  after insert on public.case_events
  for each row execute function private.on_case_child_change();
create trigger custody_transfers_broadcast
  after insert or update on public.custody_transfers
  for each row execute function private.on_case_child_change();

-- =============================================================================================
-- Storage: who may upload and download
-- =============================================================================================

-- Uploads only to a registered item's own path, once. There is no update policy, so a stored
-- file can never be replaced.
create function private.can_upload_evidence(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_items e
    where e.storage_path = p_name and e.owner_id = auth.uid()
      and e.status = 'registered' and e.uploaded_at is null
  )
$$;

-- The owner, and staff who can see a case the item is on.
create function private.can_read_evidence(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence_items e
    where e.storage_path = p_name and e.status <> 'deleted'
      and (e.owner_id = auth.uid()
           or exists (select 1 from public.case_evidence ce
                      where ce.evidence_id = e.id and private.can_see_case(ce.case_id)))
  )
$$;

create policy "Owners upload registered evidence" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence' and private.can_upload_evidence(name));

create policy "Owners and case officers read evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence' and private.can_read_evidence(name));

-- =============================================================================================
-- Custody start and case attachment
-- =============================================================================================

-- Puts an item on a case. The case's investigating officer becomes its first custodian.
create function private.attach_evidence(p_case_id uuid, p_evidence_id uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_item public.evidence_items;
begin
  select * into v_case from public.cases where id = p_case_id;
  select * into v_item from public.evidence_items where id = p_evidence_id;
  if v_case.id is null or v_item.id is null or v_item.status = 'deleted' then
    return;
  end if;
  insert into public.case_evidence (case_id, evidence_id, added_by, custodian_id)
  values (p_case_id, p_evidence_id, p_by, v_case.lead_officer_id)
  on conflict do nothing;
  if found then
    perform private.ledger_append(
      p_action       => 'custody.received',
      p_subject_type => 'evidence',
      p_subject_id   => p_evidence_id,
      p_payload      => jsonb_build_object('case', p_case_id, 'case_reference', v_case.reference,
                                           'custodian', v_case.lead_officer_id,
                                           'sha256', v_item.sha256),
      p_actor_id     => p_by
    );
  end if;
end;
$$;

-- =============================================================================================
-- Citizen (and officer) RPCs
-- =============================================================================================

-- Step 1: record the browser's hash and get the upload path. p_case_id lets an officer add
-- evidence straight to a case.
create function public.register_evidence(
  p_file_name   text,
  p_mime_type   text,
  p_size_bytes  bigint,
  p_sha256      text,
  p_kind        text default 'file',
  p_source      text default 'upload',
  p_captured_at timestamptz default null,
  p_lat         numeric default null,
  p_lng         numeric default null,
  p_accuracy_m  numeric default null,
  p_note        text default null,
  p_client_id   uuid default null,
  p_case_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid := gen_random_uuid();
  v_item public.evidence_items;
begin
  if v_uid is null then
    raise exception 'Sign in to add evidence' using errcode = 'insufficient_privilege';
  end if;
  if p_client_id is not null then
    select * into v_item from public.evidence_items where owner_id = v_uid and client_id = p_client_id;
    if found then
      return jsonb_build_object('evidence_id', v_item.id, 'storage_path', v_item.storage_path,
                                'status', v_item.status, 'created', false);
    end if;
  end if;
  if p_case_id is not null and not private.can_see_case(p_case_id) then
    raise exception 'No such case' using errcode = 'no_data_found';
  end if;
  if lower(coalesce(p_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'The file fingerprint must be a SHA-256 in hex' using errcode = 'invalid_parameter_value';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 52428800 then
    raise exception 'Files can be up to 50 MB' using errcode = 'invalid_parameter_value';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Location needs both latitude and longitude' using errcode = 'invalid_parameter_value';
  end if;
  if p_captured_at > now() + interval '5 minutes' then
    raise exception 'That time is in the future' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.evidence_items (
    id, owner_id, client_id, kind, source, file_name, mime_type, size_bytes, sha256, storage_path,
    captured_at, lat, lng, accuracy_m, note
  ) values (
    v_id, v_uid, p_client_id, coalesce(p_kind, 'file'), coalesce(p_source, 'upload'),
    left(btrim(p_file_name), 200), left(coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'), 100),
    p_size_bytes, lower(p_sha256), v_uid::text || '/' || v_id::text, p_captured_at, p_lat, p_lng,
    p_accuracy_m, nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_item;

  perform private.ledger_append(
    p_action       => 'evidence.registered',
    p_subject_type => 'evidence',
    p_subject_id   => v_item.id,
    p_payload      => jsonb_build_object('sha256', v_item.sha256, 'size', v_item.size_bytes,
                                         'mime', v_item.mime_type, 'kind', v_item.kind,
                                         'source', v_item.source, 'captured_at', v_item.captured_at,
                                         'case', p_case_id),
    p_occurred_at  => least(coalesce(p_captured_at, now()), now()),
    p_lat          => p_lat,
    p_lng          => p_lng,
    p_accuracy_m   => p_accuracy_m
  );

  if p_case_id is not null then
    perform private.attach_evidence(p_case_id, v_item.id, v_uid);
  end if;

  -- An upload that never finishes is closed after an hour.
  insert into private.jobs (kind, run_at, payload)
  values ('evidence.expire_upload', now() + interval '1 hour',
          jsonb_build_object('evidence_id', v_item.id));

  return jsonb_build_object('evidence_id', v_item.id, 'storage_path', v_item.storage_path,
                            'status', v_item.status, 'created', true);
end;
$$;

-- Step 3 (after the browser's upload): queue the server re-hash.
create function public.confirm_evidence_upload(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.evidence_items;
begin
  select * into v_item from public.evidence_items
  where id = p_evidence_id and owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'No such evidence' using errcode = 'no_data_found';
  end if;
  if v_item.status <> 'registered' or v_item.uploaded_at is not null then
    return jsonb_build_object('status', v_item.status);
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'evidence' and o.name = v_item.storage_path) then
    raise exception 'The file has not arrived yet' using errcode = 'no_data_found';
  end if;

  update public.evidence_items set uploaded_at = now() where id = p_evidence_id;
  perform private.ledger_append(
    p_action       => 'evidence.uploaded',
    p_subject_type => 'evidence',
    p_subject_id   => p_evidence_id,
    p_payload      => jsonb_build_object('sha256', v_item.sha256, 'size', v_item.size_bytes)
  );
  perform private.queue_evidence_check(p_evidence_id, 'seal', null);
  return jsonb_build_object('status', 'registered', 'uploaded', true);
end;
$$;

-- Queues a re-hash or removal and asks the function to run, with a check a minute later.
create function private.queue_evidence_check(p_evidence_id uuid, p_purpose text, p_transfer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into private.evidence_checks (evidence_id, purpose, transfer_id)
  values (p_evidence_id, p_purpose, p_transfer_id)
  returning id into v_id;
  insert into private.jobs (kind, run_at, payload)
  values ('evidence.check', now() + interval '60 seconds',
          jsonb_build_object('check_id', v_id, 'try', 1));
  perform private.request_function('evidence');
  return v_id;
end;
$$;

-- Shares a sealed item with the police: one of the citizen's reports or SOS incidents.
create function public.share_evidence(
  p_evidence_id uuid,
  p_complaint_id uuid default null,
  p_incident_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_item public.evidence_items;
  v_case uuid;
begin
  select * into v_item from public.evidence_items
  where id = p_evidence_id and owner_id = v_uid
  for update;
  if not found then
    raise exception 'No such evidence' using errcode = 'no_data_found';
  end if;
  if v_item.status <> 'sealed' then
    raise exception 'Only sealed evidence can be shared' using errcode = 'check_violation';
  end if;
  if (p_complaint_id is null) = (p_incident_id is null) then
    raise exception 'Choose one report or SOS' using errcode = 'invalid_parameter_value';
  end if;
  if p_complaint_id is not null
     and not exists (select 1 from public.complaints where id = p_complaint_id and citizen_id = v_uid) then
    raise exception 'No such report' using errcode = 'no_data_found';
  end if;
  if p_incident_id is not null
     and not exists (select 1 from public.incidents where id = p_incident_id and citizen_id = v_uid) then
    raise exception 'No such SOS' using errcode = 'no_data_found';
  end if;

  update public.evidence_items
     set complaint_id = coalesce(p_complaint_id, complaint_id),
         incident_id = coalesce(p_incident_id, incident_id),
         shared_at = coalesce(shared_at, now()),
         delete_after = null
   where id = p_evidence_id;
  perform private.ledger_append(
    p_action       => 'evidence.shared',
    p_subject_type => 'evidence',
    p_subject_id   => p_evidence_id,
    p_payload      => jsonb_build_object('complaint', p_complaint_id, 'incident', p_incident_id,
                                         'sha256', v_item.sha256)
  );
  for v_case in
    select id from public.cases
    where status = 'open'
      and ((p_complaint_id is not null and complaint_id = p_complaint_id)
        or (p_incident_id is not null and incident_id = p_incident_id))
  loop
    perform private.attach_evidence(v_case, p_evidence_id, v_uid);
  end loop;
  return jsonb_build_object('shared', true);
end;
$$;

-- Deletion waits 30 days, and is impossible once the item is shared or on a case.
create function public.request_evidence_deletion(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.evidence_items;
begin
  select * into v_item from public.evidence_items
  where id = p_evidence_id and owner_id = auth.uid()
  for update;
  if not found or v_item.status = 'deleted' then
    raise exception 'No such evidence' using errcode = 'no_data_found';
  end if;
  if v_item.shared_at is not null
     or exists (select 1 from public.case_evidence where evidence_id = p_evidence_id) then
    raise exception 'Shared evidence can''t be deleted' using errcode = 'check_violation';
  end if;
  if v_item.delete_after is null then
    update public.evidence_items set delete_after = now() + interval '30 days' where id = p_evidence_id
    returning * into v_item;
    insert into private.jobs (kind, run_at, payload)
    values ('evidence.purge', v_item.delete_after, jsonb_build_object('evidence_id', p_evidence_id));
    perform private.ledger_append(
      p_action       => 'evidence.deletion_requested',
      p_subject_type => 'evidence',
      p_subject_id   => p_evidence_id,
      p_payload      => jsonb_build_object('delete_after', v_item.delete_after)
    );
  end if;
  return jsonb_build_object('delete_after', v_item.delete_after);
end;
$$;

create function public.cancel_evidence_deletion(p_evidence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.evidence_items
     set delete_after = null
   where id = p_evidence_id and owner_id = auth.uid() and delete_after is not null
     and status <> 'deleted';
  if found then
    perform private.ledger_append(
      p_action       => 'evidence.deletion_cancelled',
      p_subject_type => 'evidence',
      p_subject_id   => p_evidence_id
    );
  end if;
end;
$$;

-- The owner's view of an item's history (the steps they can see, not officers' custody work).
create function public.evidence_timeline(p_evidence_id uuid)
returns table (seq bigint, occurred_at timestamptz, action text, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.seq, e.occurred_at, e.action, e.payload
  from public.ledger_entries e
  join public.evidence_items i on i.id = e.subject_id
  where e.subject_type = 'evidence' and e.subject_id = p_evidence_id
    and i.owner_id = auth.uid()
    and e.action like 'evidence.%'
  order by e.seq
$$;

-- =============================================================================================
-- The `evidence` Edge Function's queue (service role only)
-- =============================================================================================

create function public.claim_evidence_checks(p_limit integer default 5)
returns table (
  check_id     uuid,
  evidence_id  uuid,
  purpose      text,
  storage_path text,
  sha256       text,
  size_bytes   bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    update private.evidence_checks c
       set status = 'claimed', claimed_at = now(), attempts = c.attempts + 1
     where c.id in (
       select w.id from private.evidence_checks w
       where (w.status = 'queued' and w.next_attempt_at <= now())
          or (w.status = 'claimed' and w.claimed_at < now() - interval '2 minutes')
       order by w.created_at
       limit least(greatest(p_limit, 1), 20)
       for update skip locked
     )
    returning c.id, c.evidence_id, c.purpose
  )
  select c.id, c.evidence_id, c.purpose, i.storage_path, i.sha256, i.size_bytes
  from claimed c
  join public.evidence_items i on i.id = c.evidence_id;
end;
$$;

-- The function's answer: the stored file's SHA-256 and size, or an error. Sealing, custody and
-- deletion decisions are made here, not in the function.
create function public.finish_evidence_check(
  p_check_id   uuid,
  p_sha256     text default null,
  p_size_bytes bigint default null,
  p_error      text default null,
  p_retry      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check    private.evidence_checks;
  v_item     public.evidence_items;
  v_transfer public.custody_transfers;
  v_entry    public.ledger_entries;
  v_ok       boolean;
  v_reason   text;
begin
  select * into v_check from private.evidence_checks where id = p_check_id for update;
  if not found or v_check.status <> 'claimed' then
    return jsonb_build_object('ignored', true);
  end if;
  select * into v_item from public.evidence_items where id = v_check.evidence_id for update;

  -- Could not read the file.
  if p_error is not null then
    if coalesce(p_retry, false) and v_check.attempts < 3 then
      update private.evidence_checks
         set status = 'queued', next_attempt_at = now() + make_interval(secs => 30 * v_check.attempts),
             result = jsonb_build_object('error', left(p_error, 300))
       where id = p_check_id;
      return jsonb_build_object('retry', true);
    end if;
    perform private.fail_evidence_check(p_check_id, left(p_error, 300));
    return jsonb_build_object('failed', true);
  end if;

  if v_check.purpose = 'purge' then
    update public.evidence_items set status = 'deleted', deleted_at = now() where id = v_item.id;
    perform private.ledger_append(
      p_action       => 'evidence.deleted',
      p_subject_type => 'evidence',
      p_subject_id   => v_item.id,
      p_payload      => jsonb_build_object('sha256', v_item.sha256, 'requested_for', v_item.delete_after)
    );
    update private.evidence_checks set status = 'done', result = '{"deleted": true}' where id = p_check_id;
    return jsonb_build_object('deleted', true);
  end if;

  v_ok := lower(coalesce(p_sha256, '')) = v_item.sha256 and p_size_bytes = v_item.size_bytes;

  if v_check.purpose = 'seal' then
    if v_item.status <> 'registered' then
      v_ok := null;
    elsif v_ok then
      -- Written by the system with no location or person in it, so the public verifier can show
      -- the whole entry.
      v_entry := private.ledger_append(
        p_action       => 'evidence.sealed',
        p_subject_type => 'evidence',
        p_subject_id   => v_item.id,
        p_payload      => jsonb_build_object('sha256', v_item.sha256, 'size', v_item.size_bytes,
                                             'mime', v_item.mime_type,
                                             'registered_at', v_item.created_at)
      );
      update public.evidence_items
         set status = 'sealed', sealed_at = now(), sealed_seq = v_entry.seq
       where id = v_item.id;
    else
      v_reason := 'The stored file does not match the fingerprint taken on the device';
      update public.evidence_items set status = 'rejected', reject_reason = v_reason
       where id = v_item.id;
      perform private.ledger_append(
        p_action       => 'evidence.rejected',
        p_subject_type => 'evidence',
        p_subject_id   => v_item.id,
        p_payload      => jsonb_build_object('expected', v_item.sha256, 'got', lower(p_sha256),
                                             'expected_size', v_item.size_bytes,
                                             'got_size', p_size_bytes, 'reason', v_reason)
      );
    end if;
  elsif v_check.purpose = 'transfer' then
    select * into v_transfer from public.custody_transfers where id = v_check.transfer_id for update;
    if v_transfer.status = 'accepted' then
      update public.custody_transfers
         set status = case when v_ok then 'completed' else 'mismatch' end,
             completed_at = now(), rehash_sha256 = lower(p_sha256), rehash_ok = v_ok
       where id = v_transfer.id;
      if v_ok then
        update public.case_evidence set custodian_id = v_transfer.to_user
         where case_id = v_transfer.case_id and evidence_id = v_transfer.evidence_id;
      end if;
      perform private.ledger_append(
        p_action       => case when v_ok then 'custody.transferred' else 'custody.hash_mismatch' end,
        p_subject_type => 'evidence',
        p_subject_id   => v_item.id,
        p_payload      => jsonb_build_object('transfer', v_transfer.id, 'case', v_transfer.case_id,
                                             'from', v_transfer.from_user, 'to', v_transfer.to_user,
                                             'expected', v_item.sha256, 'rehash', lower(p_sha256),
                                             'match', v_ok)
      );
    else
      v_ok := null;
    end if;
  end if;

  update private.evidence_checks
     set status = 'done',
         result = jsonb_build_object('sha256', lower(p_sha256), 'size', p_size_bytes, 'match', v_ok)
   where id = p_check_id;
  return jsonb_build_object('match', v_ok);
end;
$$;

-- A check that could not be completed: the item or hand-off is closed as failed.
create function private.fail_evidence_check(p_check_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check private.evidence_checks;
  v_item  public.evidence_items;
begin
  update private.evidence_checks
     set status = 'failed', result = jsonb_build_object('error', p_error)
   where id = p_check_id and status in ('queued', 'claimed')
  returning * into v_check;
  if v_check.id is null then
    return;
  end if;
  select * into v_item from public.evidence_items where id = v_check.evidence_id;
  if v_check.purpose = 'seal' and v_item.status = 'registered' then
    update public.evidence_items
       set status = 'rejected', reject_reason = 'The server could not check the file: ' || p_error
     where id = v_item.id;
    perform private.ledger_append(
      p_action       => 'evidence.rejected',
      p_subject_type => 'evidence',
      p_subject_id   => v_item.id,
      p_payload      => jsonb_build_object('expected', v_item.sha256, 'reason', p_error)
    );
  elsif v_check.purpose = 'transfer' then
    update public.custody_transfers
       set status = 'mismatch', completed_at = now(), rehash_ok = false
     where id = v_check.transfer_id and status = 'accepted';
    if found then
      perform private.ledger_append(
        p_action       => 'custody.hash_mismatch',
        p_subject_type => 'evidence',
        p_subject_id   => v_item.id,
        p_payload      => jsonb_build_object('transfer', v_check.transfer_id, 'reason', p_error)
      );
    end if;
  end if;
end;
$$;

-- =============================================================================================
-- Jobs
-- =============================================================================================

-- Re-asks the function while a check waits; after five minutes the check fails.
create function private.check_evidence(p_check_id uuid, p_try integer, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check private.evidence_checks;
begin
  select * into v_check from private.evidence_checks where id = p_check_id;
  if v_check.id is null or v_check.status not in ('queued', 'claimed') then
    return;
  end if;
  if p_try >= 5 then
    perform private.fail_evidence_check(p_check_id, 'No answer from the evidence function');
    return;
  end if;
  perform private.request_function('evidence');
  insert into private.jobs (kind, run_at, payload)
  values ('evidence.check', p_now + interval '60 seconds',
          jsonb_build_object('check_id', p_check_id, 'try', p_try + 1));
end;
$$;

create function private.expire_upload(p_evidence_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.evidence_items
     set status = 'rejected', reject_reason = 'The upload did not finish'
   where id = p_evidence_id and status = 'registered' and uploaded_at is null;
  if found then
    perform private.ledger_append(
      p_action       => 'evidence.rejected',
      p_subject_type => 'evidence',
      p_subject_id   => p_evidence_id,
      p_payload      => jsonb_build_object('reason', 'The upload did not finish'),
      p_occurred_at  => p_now
    );
  end if;
end;
$$;

create function private.purge_evidence(p_evidence_id uuid, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.evidence_items;
begin
  select * into v_item from public.evidence_items where id = p_evidence_id for update;
  if v_item.id is null or v_item.status = 'deleted' or v_item.delete_after is null
     or v_item.delete_after > p_now or v_item.shared_at is not null then
    return;
  end if;
  if v_item.uploaded_at is null then
    update public.evidence_items set status = 'deleted', deleted_at = p_now where id = p_evidence_id;
    perform private.ledger_append(
      p_action       => 'evidence.deleted',
      p_subject_type => 'evidence',
      p_subject_id   => p_evidence_id,
      p_payload      => jsonb_build_object('sha256', v_item.sha256, 'file', false),
      p_occurred_at  => p_now
    );
  elsif not exists (select 1 from private.evidence_checks
                    where evidence_id = p_evidence_id and purpose = 'purge'
                      and status in ('queued', 'claimed')) then
    perform private.queue_evidence_check(p_evidence_id, 'purge', null);
  end if;
end;
$$;
