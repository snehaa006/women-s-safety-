-- Phase 4, step 1: the evidence vault, cases with a procedural workflow, signatures, custody and
-- ledger anchoring (docs/02-architecture.md §6 and §11).
--
-- A file is hashed in the browser, registered here, uploaded straight to a private Storage
-- bucket, then re-hashed by the `evidence` Edge Function. Only a matching server hash seals it.
-- Officers work on evidence inside cases: a workflow stored as data, a two-signature lock and a
-- two-party custody hand-off that re-hashes the file. Every step is a ledger entry, and the
-- ledger's Merkle roots are stamped with OpenTimestamps.

-- =============================================================================================
-- Evidence vault
-- =============================================================================================

create table public.evidence_items (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  -- Set by the app so a retried registration doesn't create a second item.
  client_id     uuid,
  kind          text not null default 'file'
                check (kind in ('photo', 'video', 'audio', 'document', 'file')),
  source        text not null default 'upload' check (source in ('upload', 'capture', 'recording')),
  file_name     text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type     text not null check (char_length(mime_type) between 1 and 100),
  size_bytes    bigint not null check (size_bytes between 1 and 52428800),
  -- The browser's SHA-256 of the file, lowercase hex. The server re-hash must match it.
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path  text not null unique,
  captured_at   timestamptz,
  lat           numeric(9, 6) check (lat between -90 and 90),
  lng           numeric(9, 6) check (lng between -180 and 180),
  accuracy_m    numeric(8, 1) check (accuracy_m >= 0),
  note          text check (char_length(note) <= 500),
  status        text not null default 'registered'
                check (status in ('registered', 'sealed', 'rejected', 'deleted')),
  uploaded_at   timestamptz,
  sealed_at     timestamptz,
  -- The ledger entry that sealed it (evidence.sealed), for the verifier and the anchor receipt.
  sealed_seq    bigint,
  reject_reason text,
  -- Shared with the police: a report or an SOS. Shared items can no longer be deleted.
  complaint_id  uuid references public.complaints (id) on delete set null,
  incident_id   uuid references public.incidents (id) on delete set null,
  shared_at     timestamptz,
  -- Deletion is delayed: 30 days to change your mind.
  delete_after  timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, client_id)
);

create index evidence_items_owner_idx on public.evidence_items (owner_id, created_at desc);
create index evidence_items_sha256_idx on public.evidence_items (sha256);
create index evidence_items_complaint_idx on public.evidence_items (complaint_id);
create index evidence_items_incident_idx on public.evidence_items (incident_id);

create trigger evidence_items_touch
  before update on public.evidence_items
  for each row execute function private.touch_updated_at();

comment on table public.evidence_items is
  'Vault items. Written only through RPCs; sealed only when the server re-hash matches the browser hash.';

-- Work for the `evidence` Edge Function: re-hash for sealing or a custody hand-off, or remove a
-- file whose deletion came due.
create table private.evidence_checks (
  id              uuid primary key default gen_random_uuid(),
  evidence_id     uuid not null references public.evidence_items (id) on delete cascade,
  purpose         text not null check (purpose in ('seal', 'transfer', 'purge')),
  transfer_id     uuid,
  status          text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed')),
  attempts        smallint not null default 0,
  claimed_at      timestamptz,
  next_attempt_at timestamptz not null default now(),
  result          jsonb,
  created_at      timestamptz not null default now()
);

create index evidence_checks_due_idx on private.evidence_checks (next_attempt_at)
  where status in ('queued', 'claimed');
create index evidence_checks_evidence_idx on private.evidence_checks (evidence_id);

-- The private bucket. 50 MB per file; the path is <owner id>/<item id>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- =============================================================================================
-- Cases and workflows
-- =============================================================================================

-- What a workflow step can require. The check for each kind is in private.requirement_met().
create table private.workflow_requirements (
  kind  text primary key,
  label text not null,
  hint  text not null
);

insert into private.workflow_requirements (kind, label, hint) values
  ('evidence_sealed',  'Evidence sealed',       'At least one evidence item whose server re-hash matched.'),
  ('site_visit',       'Site visit',            'An officer checked in within 200 m of the case location.'),
  ('statement',        'Statement recorded',    'The complainant''s statement is on the case.'),
  ('evidence_locked',  'Evidence locked',       'Every sealed item is signed by the investigating officer and a supervisor.'),
  ('custody_complete', 'Custody complete',      'No custody hand-off is waiting or failed its re-hash.');

-- A procedure stored as data. Saving creates a new version; open cases keep the version they
-- started with.
create table public.workflow_definitions (
  id         uuid primary key default gen_random_uuid(),
  key        text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  version    integer not null check (version >= 1),
  name       text not null check (char_length(btrim(name)) between 3 and 100),
  -- [{"key": "...", "label": "...", "requires": ["evidence_sealed", ...]}, ...] in order.
  states     jsonb not null check (jsonb_typeof(states) = 'array'),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (key, version)
);

create index workflow_definitions_created_by_idx on public.workflow_definitions (created_by);

insert into public.workflow_definitions (key, version, name, states) values
  ('standard', 1, 'Standard investigation', '[
    {"key": "registered",         "label": "Registered",          "requires": []},
    {"key": "evidence_collected", "label": "Evidence collected",  "requires": ["evidence_sealed"]},
    {"key": "site_inspected",     "label": "Site inspected",      "requires": ["site_visit"]},
    {"key": "statement_recorded", "label": "Statement recorded",  "requires": ["statement"]},
    {"key": "evidence_locked",    "label": "Evidence locked",     "requires": ["evidence_locked"]},
    {"key": "submitted",          "label": "Submitted to court",  "requires": ["custody_complete"]}
  ]'::jsonb);

create sequence public.case_ref_seq;

create table public.cases (
  id              uuid primary key default gen_random_uuid(),
  -- "K-2026-000007"
  reference       text not null unique,
  title           text not null check (char_length(btrim(title)) between 3 and 200),
  org_id          uuid not null references public.organizations (id),
  complaint_id    uuid references public.complaints (id) on delete set null,
  incident_id     uuid references public.incidents (id) on delete set null,
  workflow_id     uuid not null references public.workflow_definitions (id),
  state           text not null,
  lead_officer_id uuid not null references public.profiles (id),
  -- The site, for the geofenced visit check.
  lat             numeric(9, 6) check (lat between -90 and 90),
  lng             numeric(9, 6) check (lng between -180 and 180),
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index cases_one_per_complaint_idx on public.cases (complaint_id)
  where complaint_id is not null and status = 'open';
create index cases_org_idx on public.cases (org_id, created_at desc);
create index cases_incident_idx on public.cases (incident_id);
create index cases_workflow_idx on public.cases (workflow_id);
create index cases_lead_idx on public.cases (lead_officer_id);
create index cases_created_by_idx on public.cases (created_by);

create trigger cases_touch
  before update on public.cases
  for each row execute function private.touch_updated_at();

create table public.case_evidence (
  case_id      uuid not null references public.cases (id) on delete cascade,
  evidence_id  uuid not null references public.evidence_items (id) on delete cascade,
  added_by     uuid references public.profiles (id),
  added_at     timestamptz not null default now(),
  -- Who holds it now. Changes only through a completed, re-hashed hand-off.
  custodian_id uuid references public.profiles (id),
  locked_at    timestamptz,
  primary key (case_id, evidence_id)
);

create index case_evidence_evidence_idx on public.case_evidence (evidence_id);
create index case_evidence_added_by_idx on public.case_evidence (added_by);
create index case_evidence_custodian_idx on public.case_evidence (custodian_id);

-- Notes, the complainant's statement, and geofenced site check-ins.
create table public.case_events (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases (id) on delete cascade,
  kind           text not null check (kind in ('note', 'statement', 'site_visit')),
  body           text check (char_length(body) <= 4000),
  lat            numeric(9, 6),
  lng            numeric(9, 6),
  accuracy_m     numeric(8, 1),
  distance_m     numeric(10, 1),
  within_geofence boolean,
  author_id      uuid not null references public.profiles (id),
  created_at     timestamptz not null default now()
);

create index case_events_case_idx on public.case_events (case_id, created_at);
create index case_events_author_idx on public.case_events (author_id);

create table public.custody_transfers (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null,
  evidence_id   uuid not null,
  from_user     uuid not null references public.profiles (id),
  to_user       uuid not null references public.profiles (id),
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'completed', 'mismatch', 'declined', 'cancelled')),
  initiated_at  timestamptz not null default now(),
  accepted_at   timestamptz,
  completed_at  timestamptz,
  rehash_sha256 text,
  rehash_ok     boolean,
  foreign key (case_id, evidence_id) references public.case_evidence (case_id, evidence_id)
    on delete cascade
);

create unique index custody_transfers_one_open_idx on public.custody_transfers (case_id, evidence_id)
  where status in ('pending', 'accepted');
create index custody_transfers_from_idx on public.custody_transfers (from_user);
create index custody_transfers_to_idx on public.custody_transfers (to_user);

-- Officer signatures. MVP: an HMAC-SHA256 with a per-officer key held by the server and never
-- returned (docs/02-architecture.md §11 lists the WebAuthn upgrade).
create table private.signing_keys (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  secret      bytea not null,
  fingerprint text not null,
  created_at  timestamptz not null default now()
);

create table public.evidence_signatures (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null,
  evidence_id     uuid not null,
  signer_id       uuid not null references public.profiles (id),
  capacity        text not null
                  check (capacity in ('investigating_officer', 'supervisor', 'sender', 'receiver')),
  purpose         text not null check (purpose in ('lock', 'transfer_send', 'transfer_accept')),
  transfer_id     uuid references public.custody_transfers (id) on delete cascade,
  -- What was signed: SHA-256 of "purpose|case|evidence|file sha256|capacity|signer|time".
  material        text not null,
  payload_sha256  text not null,
  signature       text not null,
  key_fingerprint text not null,
  signed_at       timestamptz not null default now(),
  foreign key (case_id, evidence_id) references public.case_evidence (case_id, evidence_id)
    on delete cascade
);

create unique index evidence_signatures_lock_idx on public.evidence_signatures (case_id, evidence_id, capacity)
  where purpose = 'lock';
create index evidence_signatures_item_idx on public.evidence_signatures (case_id, evidence_id);
create index evidence_signatures_signer_idx on public.evidence_signatures (signer_id);
create index evidence_signatures_transfer_idx on public.evidence_signatures (transfer_id);

-- =============================================================================================
-- Ledger anchoring
-- =============================================================================================

-- A Merkle root over a range of ledger entries, stamped by OpenTimestamps. Only the root ever
-- leaves the database.
create table public.ledger_anchors (
  id           uuid primary key default gen_random_uuid(),
  from_seq     bigint not null,
  to_seq       bigint not null check (to_seq >= from_seq),
  leaf_count   integer not null,
  merkle_root  text not null check (merkle_root ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  ots_status   text not null default 'pending'
               check (ots_status in ('pending', 'claimed', 'submitted', 'failed')),
  ots_calendar text,
  -- The calendar's answer (base64): with the root it makes a standard .ots proof file.
  ots_receipt  text,
  claimed_at   timestamptz,
  submitted_at timestamptz,
  attempts     smallint not null default 0,
  last_error   text
);

create unique index ledger_anchors_range_idx on public.ledger_anchors (from_seq);
create index ledger_anchors_to_idx on public.ledger_anchors (to_seq);

-- =============================================================================================
-- Row-level security and privileges
-- =============================================================================================

alter table public.evidence_items enable row level security;
alter table private.evidence_checks enable row level security;
alter table private.workflow_requirements enable row level security;
alter table public.workflow_definitions enable row level security;
alter table public.cases enable row level security;
alter table public.case_evidence enable row level security;
alter table public.case_events enable row level security;
alter table public.custody_transfers enable row level security;
alter table private.signing_keys enable row level security;
alter table public.evidence_signatures enable row level security;
alter table public.ledger_anchors enable row level security;

-- Citizens read their own vault directly. Everything about cases goes through console RPCs.
create policy "Owners read their own evidence" on public.evidence_items
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Anchors hold only Merkle roots and receipts: public by design.
create policy "Anyone signed in reads anchors" on public.ledger_anchors
  for select to authenticated
  using (true);

revoke all on table public.evidence_items, public.workflow_definitions, public.cases,
  public.case_evidence, public.case_events, public.custody_transfers, public.evidence_signatures,
  public.ledger_anchors
  from public, anon, authenticated;
grant select on table public.evidence_items, public.ledger_anchors to authenticated;
grant all on table public.evidence_items, public.workflow_definitions, public.cases,
  public.case_evidence, public.case_events, public.custody_transfers, public.evidence_signatures,
  public.ledger_anchors
  to service_role;
revoke all on sequence public.case_ref_seq from public, anon, authenticated;
