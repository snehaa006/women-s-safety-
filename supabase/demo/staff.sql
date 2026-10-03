-- Demo staff accounts for the authority console. Run once against a project, as postgres:
--
--   psql "$DATABASE_URL" -v password='choose-a-password' -f supabase/demo/staff.sql
--
-- The password is never stored in the repository. Re-running resets the password and roles.
--
--   admin@demo.safety.test       Administrator (escalation policies, demo incidents)
--   supervisor@demo.safety.test  Inspector, New Delhi District Control Room (supervisor)
--   control@demo.safety.test     Officer, New Delhi District Control Room (dispatcher)
--   officer.cp@demo.safety.test  Officer, Connaught Place Police Station

select set_config('demo.password', :'password', false);

do $$
declare
  v_password text := current_setting('demo.password');
  v_staff    record;
  v_id       uuid;
begin
  if char_length(v_password) < 10 then
    raise exception 'Pick a password of at least 10 characters';
  end if;

  for v_staff in
    select * from (values
      ('admin@demo.safety.test',      'Asha Admin (demo)',     'admin'::public.app_role,      null::uuid,                              null::public.membership_role),
      ('supervisor@demo.safety.test', 'Inspector Rao (demo)',  'supervisor',                  '00000000-0000-4000-8000-000000000001', 'supervisor'),
      ('control@demo.safety.test',    'Neha Singh (demo)',     'officer',                     '00000000-0000-4000-8000-000000000001', 'dispatcher'),
      ('officer.cp@demo.safety.test', 'Ravi Kumar (demo)',     'officer',                     '00000000-0000-4000-8000-000000000011', 'officer')
    ) as s(email, full_name, role, org_id, member_role)
  loop
    select id into v_id from auth.users where email = v_staff.email;
    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        v_staff.email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', v_staff.full_name), now(), now(), '', '', '', '');
      insert into auth.identities (
        id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (
        gen_random_uuid(), v_id, v_id::text, 'email',
        jsonb_build_object('sub', v_id::text, 'email', v_staff.email, 'email_verified', true),
        now(), now(), now());
    else
      update auth.users
         set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
       where id = v_id;
    end if;

    update public.profiles set role = v_staff.role, full_name = v_staff.full_name where id = v_id;
    if v_staff.org_id is not null then
      insert into public.memberships (user_id, org_id, role, on_duty)
      values (v_id, v_staff.org_id, v_staff.member_role, true)
      on conflict (user_id, org_id) do update set role = excluded.role;
    end if;
  end loop;
end $$;

select set_config('demo.password', '', false);
