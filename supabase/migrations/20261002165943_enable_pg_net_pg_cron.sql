-- pg_net lets Postgres call Edge Functions; pg_cron runs the platform tick. Skipped on plain
-- Postgres (the tests stub pg_net and call the tick directly).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end
$$;
