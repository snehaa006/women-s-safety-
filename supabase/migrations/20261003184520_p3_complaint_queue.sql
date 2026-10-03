-- Phase 3, step 2c: the citizen's complaint timeline and claiming the AI triage queue.

-- The citizen's timeline of one complaint. Override justifications stay internal.
create function public.complaint_timeline(p_complaint_id uuid)
returns table (seq bigint, occurred_at timestamptz, action text, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.seq, e.occurred_at, e.action,
         case when e.action = 'complaint.severity_overridden'
              then (select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb)
                    from jsonb_each(e.payload) k
                    where k.key not in ('justification', 'officer'))
              else e.payload end
  from public.ledger_entries e
  join public.complaints c on c.id = e.subject_id
  where e.subject_type = 'complaint' and e.subject_id = p_complaint_id
    and c.citizen_id = auth.uid()
    and e.action <> 'complaint.override_reviewed'
  order by e.seq
$$;

-- The AI triage queue (service role only): claims waiting complaints, a few at a time.
create function public.claim_triage(p_limit integer default 5)
returns table (
  complaint_id uuid,
  description  text,
  occurred_at  timestamptz,
  created_at   timestamptz,
  rules        jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.complaints c
     set triage_claimed_at = now(), triage_attempts = c.triage_attempts + 1
   where c.id in (
     select w.id from public.complaints w
     where w.triage_state = 'pending'
       and (w.triage_claimed_at is null or w.triage_claimed_at < now() - interval '1 minute')
     order by w.created_at
     limit least(greatest(p_limit, 1), 20)
     for update skip locked
   )
  returning c.id, c.description, c.occurred_at, c.created_at, c.rules;
end;
$$;
