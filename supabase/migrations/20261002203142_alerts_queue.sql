-- Phase 1 part B, step 3: queueing and sending alerts, and Telegram linking.

-- =============================================================================================
-- Sending: queue, wake the notify function, claim, finish
-- =============================================================================================

-- Asks pg_net to call the notify function. Fire and forget: the request leaves after commit,
-- and if it is lost the next tick asks again.
create function private.request_notify()
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
    url                  => v_url || '/notify',
    body                 => '{}'::jsonb,
    params               => '{}'::jsonb,
    headers              => '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds => 10000
  );
exception when others then
  raise warning 'Could not request the notify function: %', sqlerrm;
end;
$$;

-- Queues one alert per contact and reachable channel, creating each contact's own live link.
-- template 'safe' goes only to contacts whose SOS alert was delivered. Returns the alert count.
create function private.queue_alerts(p_incident_id uuid, p_template text, p_level smallint)
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
    v_telegram := exists (select 1 from private.contact_telegram t where t.contact_id = v_contact.id);
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

-- Called by the notify function (service role). Locks due alerts, marks them sending and returns
-- what each message needs, with the address looked up now so edits to a contact take effect.
create function public.claim_alerts(p_limit integer default 25)
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
  left join private.contact_telegram tg on tg.contact_id = c.contact_id
  left join public.share_links sl on sl.id = c.share_link_id;
end;
$$;

revoke all on function
  private.request_notify(),
  private.queue_alerts(uuid, text, smallint)
  from public, anon, authenticated;

revoke all on function public.claim_alerts(integer) from public, anon, authenticated;
grant execute on function public.claim_alerts(integer) to service_role;
