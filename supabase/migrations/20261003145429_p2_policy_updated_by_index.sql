-- Covers the escalation_policies.updated_by foreign key (performance advisor).
create index if not exists escalation_policies_updated_by_idx
  on public.escalation_policies (updated_by);
