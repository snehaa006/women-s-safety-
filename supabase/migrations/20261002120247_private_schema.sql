-- Keep internals out of the public API. Supabase's REST API exposes only the public schema, so
-- helper and trigger functions move to `private`. The public API keeps the tables plus two
-- deliberate RPCs, admin_set_role() and ledger_verify(), which check the caller's role themselves.

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- Policies and triggers reference functions by id, so they follow the move.
alter function public.ledger_entry_material(public.ledger_entries) set schema private;
alter function public.ledger_sha256(text) set schema private;
alter function public.ledger_before_insert() set schema private;
alter function public.ledger_reject_change() set schema private;
alter function public.ledger_append(text, text, uuid, jsonb, timestamptz, numeric, numeric, numeric, uuid, uuid)
  set schema private;
alter function public.touch_updated_at() set schema private;
alter function public.handle_new_user() set schema private;
alter function public.current_app_role() set schema private;
alter function public.has_role(public.app_role[]) set schema private;

-- Function bodies call each other by name, so point them at the new schema.

create or replace function private.ledger_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  last_seq  bigint;
  last_hash text;
begin
  -- One writer at a time keeps seq gapless and the chain in seq order.
  perform pg_advisory_xact_lock(hashtext('public.ledger_entries'));

  select seq, entry_hash into last_seq, last_hash
  from public.ledger_entries
  order by seq desc
  limit 1;

  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.recorded_at := date_trunc('microseconds', clock_timestamp());
  new.occurred_at := date_trunc('microseconds', coalesce(new.occurred_at, new.recorded_at));
  new.payload := coalesce(new.payload, '{}'::jsonb);
  new.payload_hash := private.ledger_sha256(new.payload::text);
  new.entry_hash := private.ledger_sha256(private.ledger_entry_material(new));
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));

  perform private.ledger_append(
    p_action       => 'account.created',
    p_subject_type => 'profile',
    p_subject_id   => new.id,
    p_payload      => jsonb_build_object('role', 'citizen'),
    p_actor_id     => new.id
  );
  return new;
end;
$$;

create or replace function private.has_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (roles), false)
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     public.app_role;
  v_profile public.profiles;
begin
  -- Signed-in callers must be admins. The service role (no auth.uid()) bootstraps the first admin.
  if auth.uid() is not null and not private.has_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can change roles' using errcode = 'insufficient_privilege';
  end if;

  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'No profile with id %', p_user_id using errcode = 'no_data_found';
  end if;

  update public.profiles set role = p_role where id = p_user_id returning * into v_profile;

  perform private.ledger_append(
    p_action       => 'profile.role_changed',
    p_subject_type => 'profile',
    p_subject_id   => p_user_id,
    p_payload      => jsonb_build_object('from', v_old, 'to', p_role)
  );
  return v_profile;
end;
$$;

create or replace function public.ledger_verify(p_from_seq bigint default 1)
returns table (ok boolean, checked bigint, first_bad_seq bigint, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e        public.ledger_entries;
  expected text;
  n        bigint := 0;
begin
  -- Signed-in callers must be admin or oversight. The service role (no auth.uid()) may always run it.
  if auth.uid() is not null
     and not private.has_role(array['admin', 'oversight']::public.app_role[]) then
    raise exception 'Only admin or oversight staff can verify the ledger'
      using errcode = 'insufficient_privilege';
  end if;

  select entry_hash into expected
  from public.ledger_entries
  where seq = p_from_seq - 1;
  expected := coalesce(expected, case when p_from_seq <= 1 then repeat('0', 64) end);

  for e in
    select * from public.ledger_entries where seq >= p_from_seq order by seq
  loop
    n := n + 1;
    if e.seq <> p_from_seq + n - 1 then
      return query select false, n, e.seq, 'gap in sequence';
      return;
    end if;
    if expected is not null and e.prev_hash <> expected then
      return query select false, n, e.seq, 'prev_hash does not match the previous entry';
      return;
    end if;
    if e.payload_hash <> private.ledger_sha256(e.payload::text) then
      return query select false, n, e.seq, 'payload was changed';
      return;
    end if;
    if e.entry_hash <> private.ledger_sha256(private.ledger_entry_material(e)) then
      return query select false, n, e.seq, 'entry fields were changed';
      return;
    end if;
    expected := e.entry_hash;
  end loop;

  return query select true, n, null::bigint, null::text;
end;
$$;

-- Privileges inside private: RLS needs the role helpers; only server code may append.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_app_role(), private.has_role(public.app_role[])
  to authenticated, service_role;
grant execute on function
  private.ledger_append(text, text, uuid, jsonb, timestamptz, numeric, numeric, numeric, uuid, uuid)
  to service_role;

-- Supabase's auto-RLS event-trigger helper, if present, needs no client access.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
