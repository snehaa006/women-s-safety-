-- Phase 3, step 1: complaints, the rules triage engine, SLAs and the accountability lock's tables.
--
-- A complaint is scored twice: instantly by the rules below (a deterministic severity floor and a
-- category hint, docs/02-architecture.md §9.1), then asynchronously by an AI model when one is
-- configured. The AI can raise severity but never lower it below the rules floor; officers can
-- lower it only with a written justification that a supervisor reviews.

-- =============================================================================================
-- Complaints
-- =============================================================================================

create sequence public.complaint_ref_seq;

create table public.complaints (
  id                 uuid primary key default gen_random_uuid(),
  -- Shown to the citizen and on the console: "C-2026-000042".
  reference          text not null unique,
  citizen_id         uuid not null references public.profiles (id) on delete cascade,
  -- Set by the app so a retried submit doesn't file twice.
  client_id          uuid,
  description        text not null check (char_length(btrim(description)) between 3 and 4000),
  input_mode         text not null default 'text' check (input_mode in ('text', 'voice')),
  occurred_at        timestamptz,
  lat                numeric(9, 6) check (lat between -90 and 90),
  lng                numeric(9, 6) check (lng between -180 and 180),
  accuracy_m         numeric(8, 1) check (accuracy_m >= 0),
  -- An SOS this report is about (makes it L5 while that SOS is active).
  incident_id        uuid references public.incidents (id) on delete set null,

  -- Confidential mode: officers see only the alias until the citizen shares their identity.
  confidential       boolean not null default false,
  alias              text not null,
  identity_shared_at timestamptz,

  status             text not null default 'submitted'
                     check (status in ('submitted', 'acknowledged', 'in_progress', 'resolved', 'closed')),
  category           text not null,
  -- What officers work with now.
  severity           smallint not null check (severity between 1 and 5),
  -- The AI baseline: max(rules floor, model). Going below it needs a justification.
  baseline_severity  smallint not null check (baseline_severity between 1 and 5),
  rules              jsonb not null,
  ai                 jsonb,
  triage_state       text not null default 'pending'
                     check (triage_state in ('pending', 'done', 'skipped', 'failed')),
  triage_attempts    smallint not null default 0,
  triage_claimed_at  timestamptz,

  assigned_org_id    uuid references public.organizations (id),
  routed_how         text check (routed_how in ('jurisdiction', 'nearest', 'default')),
  sla_due_at         timestamptz not null,
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references public.profiles (id),
  escalation_level   integer not null default 0,
  escalated_at       timestamptz,
  resolved_at        timestamptz,
  outcome_note       text check (char_length(outcome_note) <= 1000),
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (citizen_id, client_id)
);

create index complaints_citizen_idx on public.complaints (citizen_id, created_at desc);
create index complaints_org_open_idx on public.complaints (assigned_org_id, sla_due_at)
  where status not in ('resolved', 'closed');
create index complaints_incident_idx on public.complaints (incident_id);
create index complaints_ack_by_idx on public.complaints (acknowledged_by);

create trigger complaints_touch
  before update on public.complaints
  for each row execute function private.touch_updated_at();

comment on table public.complaints is
  'Citizen reports. Written only through RPCs; officers read them through console RPCs that mask confidential reporters.';

-- Time to acknowledge, by severity (docs/02-architecture.md §7). Admins may tune the values.
create table public.complaint_sla (
  severity smallint primary key check (severity between 1 and 5),
  ack_s    integer not null check (ack_s between 60 and 604800)
);

insert into public.complaint_sla (severity, ack_s) values
  (5, 180), (4, 600), (3, 1200), (2, 1800), (1, 14400);

-- Downgrades below the AI baseline. Every one waits for a supervisor's review.
create table public.severity_overrides (
  id                uuid primary key default gen_random_uuid(),
  complaint_id      uuid not null references public.complaints (id) on delete cascade,
  org_id            uuid references public.organizations (id),
  from_severity     smallint not null check (from_severity between 1 and 5),
  to_severity       smallint not null check (to_severity between 1 and 5),
  baseline_severity smallint not null check (baseline_severity between 1 and 5),
  justification     text not null check (char_length(btrim(justification)) between 20 and 1000),
  officer_id        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(),
  review_status     text not null default 'pending'
                    check (review_status in ('pending', 'upheld', 'reversed')),
  reviewed_by       uuid references public.profiles (id),
  reviewed_at       timestamptz,
  review_note       text check (char_length(review_note) <= 1000)
);

create index severity_overrides_complaint_idx on public.severity_overrides (complaint_id);
create index severity_overrides_pending_idx on public.severity_overrides (org_id, created_at)
  where review_status = 'pending';
create index severity_overrides_officer_idx on public.severity_overrides (officer_id);
create index severity_overrides_reviewer_idx on public.severity_overrides (reviewed_by);

-- =============================================================================================
-- The rules engine
-- =============================================================================================

-- What each category means and how bad it is: in the past, just now, or happening now.
create table private.triage_categories (
  category text primary key,
  label    text not null,
  base     smallint not null check (base between 1 and 5),
  recent   smallint not null check (recent between 1 and 5),
  ongoing  smallint not null check (ongoing between 1 and 5),
  -- Picks the category when several match ("my husband beats me": domestic violence, not assault).
  priority smallint not null
);

insert into private.triage_categories (category, label, base, recent, ongoing, priority) values
  ('abduction',           'Abduction or attempted abduction', 5, 5, 5, 95),
  ('sexual_assault',      'Sexual assault',                   4, 5, 5, 90),
  ('domestic_violence',   'Domestic violence',                2, 3, 4, 85),
  ('assault',             'Physical assault',                 3, 4, 5, 80),
  ('stalking',            'Stalking or being followed',       2, 3, 4, 70),
  ('sexual_harassment',   'Groping or sexual harassment',     2, 3, 4, 65),
  ('threat',              'Threats or intimidation',          3, 3, 4, 60),
  ('cyber_harassment',    'Online harassment',                2, 2, 3, 40),
  ('harassment',          'Verbal harassment',                2, 2, 3, 35),
  ('suspicious_activity', 'Suspicious people nearby',         2, 3, 3, 20),
  ('public_safety',       'Unsafe place (lighting, CCTV)',    1, 1, 1, 10),
  ('other',               'Other',                            2, 2, 3, 0);

-- Phrases in English, Hindi (Devanagari) and Hinglish. A pattern is a case-insensitive POSIX
-- regular expression. A row names a category, a signal, a direct severity, or several.
create table private.triage_lexicon (
  id       integer generated always as identity primary key,
  pattern  text not null,
  category text references private.triage_categories (category),
  signal   text check (signal ~ '^[a-z_]+$'),
  severity smallint check (severity between 1 and 5),
  check (category is not null or signal is not null)
);

insert into private.triage_lexicon (pattern, category, signal, severity) values
  -- When: happening now, just happened, in the past.
  ('(kar|ho|aa|ja|dekh|ghoor|chal|baith)\s*(raha|rahi|rahe)\s*(hai|hain|h)\M', null, 'ongoing', null),
  ('\m(right now|currently|still|abhi bhi|(is|are) \w+ing (me|us)|(has|have) been \w+ing|keeps? \w+ing)\M', null, 'ongoing', null),
  ('(रहा|रही|रहे)\s*(है|हैं)', null, 'ongoing', null),
  ('\m(roz|rozana|daily|every ?day|har din|always|baar baar|repeatedly|again and again)\M|रोज़?|बार बार', null, 'repeated', null),
  ('\m(just now|abhi abhi|thodi der pehle|few minutes ago|minutes ago|an hour ago)\M|अभी अभी', null, 'just_now', null),
  ('\m(yesterday|last (week|night|month|year)|pichhle|pichle|kal raat)\M|पिछले', null, 'past', null),
  -- Immediate danger.
  ('\m(knife|chaku|chaaku|gun|pistol|katta|revolver|blade|weapon|acid|tezaab|tejab)\M|चाकू|बंदूक|तेजाब', 'threat', 'weapon', 5),
  ('\m(help me|save me|bachao|bachaao|bacha lo)\M|बचाओ', null, 'urgent_help', 5),
  ('\m(kidnap\w*|abduct\w*|agwa|utha\s*(ke|kar)\s*le|forced? (me )?into (a|the|his) (car|van|auto))\M|अगवा|अपहरण', 'abduction', null, 5),
  -- Categories.
  ('\m(rape\w*|gang ?rape\w*|balatkar|sexual(ly)? assault\w*)\M|बलात्कार', 'sexual_assault', null, null),
  ('\m(hit|beat\w*|slapp?\w*|thappad|maara|maar\s*(raha|rahe|diya|di)|maar(ta|ti|te)|pitai|peet\w*|attack\w*|punch\w*|kick\w*)\M|पीट|मारा|हमला', 'assault', null, null),
  ('\m(follow\w*|stalk\w*|peech?ha|pichha|peeche|pichhe)\M|पीछा|पीछे', 'stalking', null, null),
  ('\m(grop\w*|touch(ed|ing)? me|molest\w*|chhed\w*|chhua|chhuaa|chhoo\w*|chhu(ne|ta|ti|kar)|chedkhani|chhedkhani|flash\w*)\M|छेड़|छू', 'sexual_harassment', null, null),
  ('\m(dowry|dahej|sasural|in-?laws?)\M|दहेज|ससुराल|घरेलू हिंसा|((husband|pati|शौहर|पति).{0,40}(beat|hit|maar|pit|torture|पीट|मार))', 'domestic_violence', null, null),
  ('\m(threat\w*|dhamki|dhamka\w*|kill (you|me)|jaan se|maar (dunga|denge|dalunga)|acid (phenk|throw))\M|धमकी|जान से', 'threat', null, null),
  ('\m(blackmail\w*|morph\w*|sextortion|leak\w*|viral|doxx\w*|fake (profile|account)|nude|obscene (message|photo|video)s?)\M', 'cyber_harassment', 'image_abuse', 3),
  ('\m(instagram|whatsapp|facebook|snapchat|telegram|online|dms?|messages? me)\M', 'cyber_harassment', null, null),
  ('\m(harass\w*|catcall\w*|seeti|whistl\w*|gaali|abus\w*|comment\w*|tang kar|pareshan|ghoor\w*|stare\w*|staring)\M|परेशान|गाली|घूर', 'harassment', null, null),
  ('\m(group of (men|boys|guys)|ladke khade|gang|drunk|nashe|sharabi|suspicious)\M|शराबी', 'suspicious_activity', null, null),
  ('\m(street ?lights?|lighting|andhera|no lights?|dark (street|road|lane|stretch)|cctv|broken light)\M|अंधेरा', 'public_safety', null, null),
  -- Context.
  ('\m(night|raat|late evening|midnight)\M|रात', null, 'night', null),
  ('\m(alone|akeli|akela|sunsaan|isolated|deserted|empty (road|street|lane))\M|अकेली|सुनसान', null, 'isolated', null),
  ('\m(metro|bus|auto|cab|uber|ola|train|rickshaw)\M|मेट्रो', null, 'public_transport', null),
  ('\m(injur\w*|bleed\w*|blood|khoon|chot|hurt)\M|खून|चोट', null, 'injury', 4);

-- Plain words for the rationale.
create table private.triage_signal_labels (
  signal text primary key,
  label  text not null
);

insert into private.triage_signal_labels (signal, label) values
  ('ongoing', 'happening now'),
  ('repeated', 'keeps happening'),
  ('just_now', 'just happened'),
  ('past', 'in the past'),
  ('weapon', 'a weapon is mentioned'),
  ('urgent_help', 'asks for help now'),
  ('image_abuse', 'images or blackmail'),
  ('night', 'at night'),
  ('isolated', 'alone or in an isolated place'),
  ('public_transport', 'on public transport'),
  ('injury', 'injury mentioned'),
  ('linked_sos', 'linked to an active SOS');

-- The rules triage: category hint, severity floor, signals and a rationale. Deterministic, and
-- fast enough to run as the citizen types.
create function private.triage_rules(p_text text, p_linked_sos boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text       text := lower(coalesce(p_text, ''));
  v_signals    text[] := '{}';
  v_categories text[] := '{}';
  v_direct     smallint := 0;
  v_category   private.triage_categories;
  v_floor      smallint;
  v_when       text;
  v_row        record;
  v_language   text;
  v_reason     text;
begin
  for v_row in select * from private.triage_lexicon order by id loop
    if v_text ~* v_row.pattern then
      if v_row.signal is not null and not v_row.signal = any (v_signals) then
        v_signals := v_signals || v_row.signal;
      end if;
      if v_row.category is not null and not v_row.category = any (v_categories) then
        v_categories := v_categories || v_row.category;
      end if;
      v_direct := greatest(v_direct, coalesce(v_row.severity, 0));
    end if;
  end loop;
  if p_linked_sos then
    v_signals := v_signals || 'linked_sos'::text;
    v_direct := 5;
  end if;

  select * into v_category from private.triage_categories
  where category = any (v_categories)
  order by priority desc
  limit 1;
  if not found then
    select * into v_category from private.triage_categories where category = 'other';
  end if;

  v_when := case
    when v_signals && array['ongoing', 'repeated', 'urgent_help'] then 'ongoing'
    when 'just_now' = any (v_signals) then 'recent'
    else 'base' end;
  v_floor := greatest(
    case v_when when 'ongoing' then v_category.ongoing
                when 'recent' then v_category.recent
                else v_category.base end,
    v_direct);

  v_language := case
    when v_text ~ '[ऀ-ॿ]' then 'hi'
    when v_text ~* '\m(hai|hain|nahi|mera|meri|mujhe|raha|rahi|kar|aadmi|ladka|wala|ko|se)\M' then 'hinglish'
    else 'en' end;

  select string_agg(l.label, ', ' order by array_position(v_signals, l.signal))
    into v_reason
  from private.triage_signal_labels l
  where l.signal = any (v_signals);

  return jsonb_build_object(
    'category', v_category.category,
    'category_label', v_category.label,
    'severity', v_floor,
    'signals', to_jsonb(v_signals),
    'categories', to_jsonb(v_categories),
    'language', v_language,
    'rationale', v_category.label || ' (L' || v_floor || ')'
                 || coalesce(': ' || v_reason, '') || '.',
    'version', 'rules-v1'
  );
end;
$$;

-- =============================================================================================
-- Row-level security and privileges
-- =============================================================================================

alter table public.complaints enable row level security;
alter table public.complaint_sla enable row level security;
alter table public.severity_overrides enable row level security;
alter table private.triage_categories enable row level security;
alter table private.triage_lexicon enable row level security;
alter table private.triage_signal_labels enable row level security;

create policy "Citizens read their own complaints" on public.complaints
  for select to authenticated
  using (citizen_id = (select auth.uid()));

create policy "Signed-in users read SLA targets" on public.complaint_sla
  for select to authenticated
  using (true);

revoke all on table public.complaints, public.complaint_sla, public.severity_overrides
  from public, anon, authenticated;
grant select on table public.complaints, public.complaint_sla to authenticated;
grant all on table public.complaints, public.complaint_sla, public.severity_overrides
  to service_role;
revoke all on sequence public.complaint_ref_seq from public, anon, authenticated;

revoke all on function private.triage_rules(text, boolean) from public, anon, authenticated;
