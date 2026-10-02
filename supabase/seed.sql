-- Demo data for local development (`supabase db reset`). Not applied to hosted projects by default.
-- Fixed ids keep links stable. To make staff: sign up, then run select public.admin_set_role(...).

insert into public.organizations (id, name, type, parent_id, phone) values
  ('00000000-0000-4000-8000-000000000001', 'Demo District Control Room', 'control_room', null, '112'),
  ('00000000-0000-4000-8000-000000000011', 'Sector 21 Police Station', 'police_station',
   '00000000-0000-4000-8000-000000000001', null),
  ('00000000-0000-4000-8000-000000000012', 'Civil Lines Police Station', 'police_station',
   '00000000-0000-4000-8000-000000000001', null),
  ('00000000-0000-4000-8000-000000000013', 'Railway Station Police Post', 'police_station',
   '00000000-0000-4000-8000-000000000001', null),
  ('00000000-0000-4000-8000-000000000021', 'Demo College Security Desk', 'campus_security',
   '00000000-0000-4000-8000-000000000011', null)
on conflict (id) do nothing;
