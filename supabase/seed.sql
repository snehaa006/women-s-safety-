-- Local development only (`supabase db reset`); hosted projects get their data from migrations.
-- The demo district (stations, jurisdictions, patrol units) comes from the Phase 2 migrations.
-- To make staff: sign up, then run select public.admin_set_role(...) and add a membership.

-- Inside a local stack the database reaches Edge Functions through the API gateway.
update private.settings set value = 'http://kong:8000/functions/v1' where key = 'functions_url';
