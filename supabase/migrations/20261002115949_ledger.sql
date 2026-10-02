-- Integrity ledger: an append-only, hash-chained log of every meaningful action.
-- See docs/02-architecture.md section 6. The chain is enforced here in Postgres, so no code path
-- (API, Edge Function or dashboard) can write an entry without hashing and linking it.

create table public.ledger_entries (
  seq          bigint primary key,
  id           uuid not null unique default gen_random_uuid(),
  occurred_at  timestamptz not null,
  recorded_at  timestamptz not null,
  actor_id     uuid,
  actor_role   text,
  device_id    uuid,
  action       text not null check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  subject_type text not null check (subject_type ~ '^[a-z][a-z_]*$'),
  subject_id   uuid,
  lat          numeric(9, 6) check (lat between -90 and 90),
  lng          numeric(9, 6) check (lng between -180 and 180),
  accuracy_m   numeric(8, 1) check (accuracy_m >= 0),
  payload      jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  prev_hash    text not null,
  entry_hash   text not null unique
);

create index ledger_entries_subject_idx on public.ledger_entries (subject_type, subject_id, seq);
create index ledger_entries_actor_idx on public.ledger_entries (actor_id, seq);

comment on table public.ledger_entries is
  'Append-only hash chain. entry_hash covers every field plus prev_hash; see ledger_entry_material().';

-- The exact bytes that get hashed. Timestamps are rendered in UTC with microseconds so any
-- verifier, in any language, can rebuild the same string from a row.
create function public.ledger_entry_material(e public.ledger_entries)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws('|',
    e.seq::text,
    e.prev_hash,
    to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(e.actor_id::text, ''),
    coalesce(e.actor_role, ''),
    coalesce(e.device_id::text, ''),
    e.action,
    e.subject_type,
    coalesce(e.subject_id::text, ''),
    coalesce(e.lat::text, ''),
    coalesce(e.lng::text, ''),
    coalesce(e.accuracy_m::text, ''),
    e.payload_hash
  )
$$;

create function public.ledger_sha256(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(input, 'UTF8')), 'hex')
$$;

-- Fills in seq, recorded_at and the hashes. Callers cannot choose them.
create function public.ledger_before_insert()
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
  new.payload_hash := public.ledger_sha256(new.payload::text);
  new.entry_hash := public.ledger_sha256(public.ledger_entry_material(new));
  return new;
end;
$$;

create trigger ledger_before_insert
before insert on public.ledger_entries
for each row execute function public.ledger_before_insert();

-- Corrections are new entries that reference the original. Rows never change or disappear.
create function public.ledger_reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ledger_entries is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger ledger_no_update_delete
before update or delete on public.ledger_entries
for each row execute function public.ledger_reject_change();

create trigger ledger_no_truncate
before truncate on public.ledger_entries
for each statement execute function public.ledger_reject_change();

-- The single way to write an entry. Actor and role are taken from the session, never the caller.
create function public.ledger_append(
  p_action       text,
  p_subject_type text,
  p_subject_id   uuid,
  p_payload      jsonb default '{}'::jsonb,
  p_occurred_at  timestamptz default null,
  p_lat          numeric default null,
  p_lng          numeric default null,
  p_accuracy_m   numeric default null,
  p_device_id    uuid default null,
  p_actor_id     uuid default null
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), p_actor_id);
  v_role  text;
  v_entry public.ledger_entries;
begin
  if v_actor is not null then
    select role::text into v_role from public.profiles where id = v_actor;
  end if;
  v_role := coalesce(v_role, case when v_actor is null then 'system' end);

  insert into public.ledger_entries (
    occurred_at, actor_id, actor_role, device_id, action, subject_type, subject_id,
    lat, lng, accuracy_m, payload
  ) values (
    p_occurred_at, v_actor, v_role, p_device_id, p_action, p_subject_type, p_subject_id,
    p_lat, p_lng, p_accuracy_m, p_payload
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function public.ledger_append is
  'Append a ledger entry. Not callable by browsers: domain functions and the backend (service role) call it.';

-- Recomputes every hash and link. Returns the first broken entry, if any.
create function public.ledger_verify(p_from_seq bigint default 1)
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
  if auth.uid() is not null and coalesce(
    (select role::text from public.profiles where id = auth.uid()), ''
  ) not in ('admin', 'oversight') then
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
    if e.payload_hash <> public.ledger_sha256(e.payload::text) then
      return query select false, n, e.seq, 'payload was changed';
      return;
    end if;
    if e.entry_hash <> public.ledger_sha256(public.ledger_entry_material(e)) then
      return query select false, n, e.seq, 'entry fields were changed';
      return;
    end if;
    expected := e.entry_hash;
  end loop;

  return query select true, n, null::bigint, null::text;
end;
$$;

-- Privileges. Browsers never write the ledger directly; RLS policies for reading are added in
-- the identity migration (they need profiles) and by each module for its own subjects.
alter table public.ledger_entries enable row level security;

revoke all on table public.ledger_entries from public, anon, authenticated;
grant select on table public.ledger_entries to authenticated;

revoke all on function public.ledger_append from public, anon, authenticated;
grant execute on function public.ledger_append to service_role;

revoke all on function public.ledger_verify from public, anon;
grant execute on function public.ledger_verify to authenticated, service_role;
