-- Phase 1 part B, step 4: reporting send results, and Telegram linking.
--
-- Unlinking a Telegram chat marks it inactive (unlinked_at) instead of removing the row, so the
-- link history stays and queue_alerts/claim_alerts only use active links.

alter table private.contact_telegram add column unlinked_at timestamptz;

create or replace function private.telegram_active(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.contact_telegram t
    where t.contact_id = p_contact_id and t.unlinked_at is null
  )
$$;

-- Only active Telegram links get alerts.
create or replace function private.queue_alerts(p_incident_id uuid, p_template text, p_level smallint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents;
  v_contact  public.trusted_contacts;
  v_telegram boolean;
  v_link     uuid;
  v_count    integer := 0;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    return 0;
  end if;

  for v_contact in
    select c.* from public.trusted_contacts c
    where c.owner_id = v_incident.citizen_id
    order by c.priority, c.created_at
  loop
    v_telegram := private.telegram_active(v_contact.id);
    continue when v_contact.email is null and not v_telegram;
    continue when p_template = 'safe' and not exists (
      select 1 from public.alerts a
      where a.incident_id = p_incident_id and a.contact_id = v_contact.id
        and a.template = 'sos' and a.status = 'sent'
    );

    v_link := (select l.id from public.share_links l
               where l.incident_id = p_incident_id and l.contact_id = v_contact.id);
    if v_link is null then
      insert into public.share_links (incident_id, citizen_id, audience, contact_id, recipient_name)
      values (p_incident_id, v_incident.citizen_id, 'contact', v_contact.id, v_contact.name)
      returning id into v_link;
    end if;

    if v_contact.email is not null then
      insert into public.alerts (
        incident_id, citizen_id, contact_id, share_link_id, recipient_name, level, template, channel
      ) values (
        p_incident_id, v_incident.citizen_id, v_contact.id, v_link, v_contact.name, p_level,
        p_template, 'email'
      );
      v_count := v_count + 1;
    end if;
    if v_telegram then
      insert into public.alerts (
        incident_id, citizen_id, contact_id, share_link_id, recipient_name, level, template, channel
      ) values (
        p_incident_id, v_incident.citizen_id, v_contact.id, v_link, v_contact.name, p_level,
        p_template, 'telegram'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.claim_alerts(p_limit integer default 25)
returns table (
  alert_id        uuid,
  channel         text,
  template        text,
  level           smallint,
  attempts        smallint,
  address         text,
  recipient_name  text,
  citizen_name    text,
  citizen_phone   text,
  link_token      text,
  incident_status text,
  lat             numeric,
  lng             numeric,
  location_at     timestamptz,
  started_at      timestamptz,
  source          text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id
    from public.alerts a
    where a.status = 'queued' and a.next_attempt_at <= now()
    order by a.next_attempt_at
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  ),
  claimed as (
    update public.alerts a
       set status = 'sending', attempts = a.attempts + 1
      from due
     where a.id = due.id
    returning a.*
  )
  select c.id,
         c.channel,
         c.template,
         c.level,
         c.attempts,
         case c.channel when 'email' then tc.email when 'telegram' then tg.chat_id::text end,
         c.recipient_name,
         nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''),
         p.phone,
         sl.token,
         i.status,
         i.last_lat,
         i.last_lng,
         i.last_location_at,
         i.started_at,
         i.source
  from claimed c
  join public.incidents i on i.id = c.incident_id
  join public.profiles p on p.id = c.citizen_id
  left join public.trusted_contacts tc on tc.id = c.contact_id
  left join private.contact_telegram tg on tg.contact_id = c.contact_id and tg.unlinked_at is null
  left join public.share_links sl on sl.id = c.share_link_id;
end;
$$;

-- Called by the notify function with each result. p_outcome: sent | failed | skipped.
-- A failure with p_retry is tried again after 30 s and 2 min, then recorded as failed.
create function public.finish_alert(
  p_alert_id     uuid,
  p_outcome      text,
  p_provider_ref text default null,
  p_error        text default null,
  p_retry        boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert   public.alerts;
  v_payload jsonb;
begin
  if p_outcome not in ('sent', 'failed', 'skipped') then
    raise exception 'Unknown outcome %', p_outcome using errcode = 'invalid_parameter_value';
  end if;

  select * into v_alert from public.alerts where id = p_alert_id for update;
  if not found or v_alert.status <> 'sending' then
    return coalesce(v_alert.status, 'unknown');
  end if;

  v_payload := jsonb_build_object(
    'alert', v_alert.id, 'channel', v_alert.channel, 'to', v_alert.recipient_name,
    'template', v_alert.template, 'level', v_alert.level
  );

  if p_outcome = 'sent' then
    update public.alerts
       set status = 'sent', sent_at = now(), provider_ref = left(p_provider_ref, 200),
           last_error = null
     where id = p_alert_id;
    perform private.ledger_append(
      p_action       => 'alert.sent',
      p_subject_type => 'incident',
      p_subject_id   => v_alert.incident_id,
      p_payload      => v_payload
    );
    return 'sent';
  end if;

  if p_outcome = 'failed' and p_retry and v_alert.attempts < 3 then
    update public.alerts
       set status = 'queued',
           next_attempt_at = now() + interval '30 seconds' * power(4, v_alert.attempts - 1),
           last_error = left(p_error, 300)
     where id = p_alert_id;
    return 'queued';
  end if;

  update public.alerts
     set status = p_outcome, last_error = left(p_error, 300)
   where id = p_alert_id;
  perform private.ledger_append(
    p_action       => 'alert.' || p_outcome,
    p_subject_type => 'incident',
    p_subject_id   => v_alert.incident_id,
    p_payload      => v_payload || jsonb_build_object('reason', left(coalesce(p_error, ''), 200))
  );
  return p_outcome;
end;
$$;

-- =============================================================================================
-- Telegram linking (the telegram-webhook function calls these with the service role)
-- =============================================================================================

create function public.link_telegram(p_code text, p_chat_id bigint, p_username text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.trusted_contacts;
  v_owner   text;
begin
  select * into v_contact from public.trusted_contacts where telegram_code = p_code for update;
  if not found then
    return jsonb_build_object('status', 'unknown_code');
  end if;

  insert into private.contact_telegram (contact_id, chat_id)
  values (v_contact.id, p_chat_id)
  on conflict (contact_id) do update
    set chat_id = excluded.chat_id, linked_at = now(), unlinked_at = null;

  update public.trusted_contacts
     set telegram_linked_at = now(),
         telegram_username = left(nullif(btrim(p_username), ''), 64),
         telegram_code = private.new_token()
   where id = v_contact.id;

  perform private.ledger_append(
    p_action       => 'contact.telegram_linked',
    p_subject_type => 'profile',
    p_subject_id   => v_contact.owner_id,
    p_payload      => jsonb_build_object('contact', v_contact.id, 'name', v_contact.name)
  );

  select nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), '') into v_owner
  from public.profiles where id = v_contact.owner_id;
  return jsonb_build_object('status', 'linked', 'owner_name', v_owner,
                            'contact_name', v_contact.name);
end;
$$;

-- The contact sent /stop to the bot: stop sending them anything.
create function public.unlink_telegram_chat(p_chat_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.trusted_contacts;
  v_count   integer := 0;
begin
  for v_contact in
    select c.* from public.trusted_contacts c
    join private.contact_telegram t on t.contact_id = c.id
    where t.chat_id = p_chat_id and t.unlinked_at is null
  loop
    update private.contact_telegram set unlinked_at = now() where contact_id = v_contact.id;
    update public.trusted_contacts
       set telegram_linked_at = null, telegram_username = null
     where id = v_contact.id;
    perform private.ledger_append(
      p_action       => 'contact.telegram_unlinked',
      p_subject_type => 'profile',
      p_subject_id   => v_contact.owner_id,
      p_payload      => jsonb_build_object('contact', v_contact.id, 'by', 'contact')
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The citizen disconnects a contact's Telegram (for example, the wrong person linked it).
create function public.disconnect_telegram(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trusted_contacts
     set telegram_linked_at = null, telegram_username = null, telegram_code = private.new_token()
   where id = p_contact_id and owner_id = auth.uid();
  if not found then
    raise exception 'No such contact' using errcode = 'no_data_found';
  end if;
  update private.contact_telegram set unlinked_at = now()
   where contact_id = p_contact_id and unlinked_at is null;
  perform private.ledger_append(
    p_action       => 'contact.telegram_unlinked',
    p_subject_type => 'profile',
    p_subject_id   => auth.uid(),
    p_payload      => jsonb_build_object('contact', p_contact_id, 'by', 'owner')
  );
end;
$$;

-- =============================================================================================
-- Privileges: only the notify and telegram-webhook functions (service role) send and link
-- =============================================================================================

revoke all on function private.telegram_active(uuid) from public, anon, authenticated;

revoke all on function
  public.finish_alert(uuid, text, text, text, boolean),
  public.link_telegram(text, bigint, text),
  public.unlink_telegram_chat(bigint),
  public.disconnect_telegram(uuid)
  from public, anon, authenticated;

grant execute on function
  public.finish_alert(uuid, text, text, text, boolean),
  public.link_telegram(text, bigint, text),
  public.unlink_telegram_chat(bigint)
  to service_role;

grant execute on function public.disconnect_telegram(uuid) to authenticated, service_role;
