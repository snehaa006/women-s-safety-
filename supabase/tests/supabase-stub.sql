-- Minimal stand-in for the parts of Supabase the migrations rely on (roles, auth.users,
-- auth.uid(), default grants), so they can be tested on plain Postgres without the Supabase CLI.
-- Never apply this to a real Supabase project.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Supabase installs extensions such as pgcrypto into their own schema.
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Same contract as Supabase: the user id comes from the request's JWT claims.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants everything in public to the API roles by default and relies on RLS.
-- The migrations must hold up against these defaults.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- pg_net: requests are recorded instead of sent, so tests can see that the notify function was
-- asked to run. Same signature as the real net.http_post.
create schema net;
create table net.requests (
  id      bigint generated always as identity primary key,
  url     text not null,
  body    jsonb,
  headers jsonb,
  at      timestamptz not null default now()
);
create function net.http_post(
  url                  text,
  body                 jsonb default '{}'::jsonb,
  params               jsonb default '{}'::jsonb,
  headers              jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language sql
as $$
  insert into net.requests (url, body, headers) values (url, body, headers) returning id
$$;

-- Realtime: broadcast from the database writes to realtime.messages; private topics are
-- authorized by RLS policies on that table, with the topic in the realtime.topic setting.
create schema realtime;
create table realtime.messages (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,
  extension   text not null,
  payload     jsonb,
  event       text,
  private     boolean default false,
  inserted_at timestamp not null default now()
);
alter table realtime.messages enable row level security;
create function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language sql
as $$
  insert into realtime.messages (topic, extension, payload, event, private)
  values (topic, 'broadcast', payload, event, private)
$$;
grant usage on schema realtime to anon, authenticated, service_role;
grant select on realtime.messages to authenticated;
grant execute on function realtime.topic() to anon, authenticated, service_role;

-- Storage: buckets and objects with the same columns the migrations touch. RLS on objects is
-- what Supabase Storage checks for every upload and download.
create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
