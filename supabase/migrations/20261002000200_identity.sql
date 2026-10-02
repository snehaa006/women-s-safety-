-- Identity: profiles, responder organizations and memberships.
-- Everyone signs up as a citizen. Staff roles are granted only by an admin, and every grant is
-- written to the ledger. Location and jurisdiction columns arrive in Phase 2 with PostGIS.

create type public.app_role as enum ('citizen', 'officer', 'supervisor', 'oversight', 'admin');
create type public.org_type as enum ('police_station', 'campus_security', 'control_room');
create type public.membership_role as enum ('officer', 'supervisor', 'dispatcher');

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  type       public.org_type not null,
  parent_id  uuid references public.organizations (id),
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  check (parent_id is distinct from id)
);

create index organizations_parent_idx on public.organizations (parent_id);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  phone      text,
  role       public.app_role not null default 'citizen',
  locale     text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  role       public.membership_role not null default 'officer',
  on_duty    boolean not null default false,
  badge_no   text,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index memberships_org_idx on public.memberships (org_id);

-- Keep updated_at honest.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

-- Every new auth user gets a citizen profile, and the ledger records it.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));

  perform public.ledger_append(
    p_action       => 'account.created',
    p_subject_type => 'profile',
    p_subject_id   => new.id,
    p_payload      => jsonb_build_object('role', 'citizen'),
    p_actor_id     => new.id
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Role helpers. Security definer so RLS policies can call them without recursing into profiles.
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.has_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

-- The only way to change someone's role. Admin only, and ledgered.
create function public.admin_set_role(p_user_id uuid, p_role public.app_role)
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
  if auth.uid() is not null and not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can change roles' using errcode = 'insufficient_privilege';
  end if;

  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'No profile with id %', p_user_id using errcode = 'no_data_found';
  end if;

  update public.profiles set role = p_role where id = p_user_id returning * into v_profile;

  perform public.ledger_append(
    p_action       => 'profile.role_changed',
    p_subject_type => 'profile',
    p_subject_id   => p_user_id,
    p_payload      => jsonb_build_object('from', v_old, 'to', p_role)
  );
  return v_profile;
end;
$$;

-- Row level security ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

-- Profiles: people see and edit their own. Admins see everyone. Officers do not get a blanket
-- read of citizen profiles: confidential reporting depends on that.
create policy "Read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "Admins read all profiles" on public.profiles
  for select to authenticated
  using (public.has_role(array['admin']::public.app_role[]));

create policy "Update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Organizations: names and types are not secret; only admins change them.
create policy "Signed-in users read organizations" on public.organizations
  for select to authenticated
  using (true);

create policy "Admins manage organizations" on public.organizations
  for all to authenticated
  using (public.has_role(array['admin']::public.app_role[]))
  with check (public.has_role(array['admin']::public.app_role[]));

-- Memberships: staff see their own; admins manage all.
create policy "Read own memberships" on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

create policy "Admins manage memberships" on public.memberships
  for all to authenticated
  using (public.has_role(array['admin']::public.app_role[]))
  with check (public.has_role(array['admin']::public.app_role[]));

-- Ledger: admins and oversight read everything; everyone reads entries they authored.
-- Modules add policies for the subjects they own (for example a citizen's own incident).
create policy "Oversight reads the ledger" on public.ledger_entries
  for select to authenticated
  using (public.has_role(array['admin', 'oversight']::public.app_role[]));

create policy "Read own ledger entries" on public.ledger_entries
  for select to authenticated
  using (actor_id = auth.uid());

-- Privileges ------------------------------------------------------------------------------------

revoke all on table public.profiles, public.organizations, public.memberships
  from public, anon, authenticated;

grant select on table public.profiles to authenticated;
-- Column list: a user can never set their own role.
grant update (full_name, phone, locale) on table public.profiles to authenticated;

grant select, insert, update, delete on table public.organizations to authenticated;
grant select, insert, update, delete on table public.memberships to authenticated;

grant all on table public.profiles, public.organizations, public.memberships to service_role;

revoke all on function public.handle_new_user from public, anon, authenticated;
revoke all on function public.admin_set_role from public, anon;
grant execute on function public.admin_set_role to authenticated, service_role;

-- Helpers are for RLS and server code, not for anonymous visitors.
revoke all on function public.current_app_role, public.has_role, public.touch_updated_at
  from public, anon;
grant execute on function public.current_app_role, public.has_role to authenticated, service_role;
revoke all on function public.ledger_sha256, public.ledger_entry_material from public, anon;
