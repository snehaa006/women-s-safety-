-- Phase 3, step 2e: privileges for the complaint engine.
revoke all on function
  private.complaint_ack_s(smallint),
  private.broadcast_complaint(uuid, text),
  private.on_complaint_change(),
  private.request_triage(),
  private.reset_complaint_sla(uuid, timestamptz),
  private.escalate_complaint(uuid, integer, timestamptz),
  private.check_triage(uuid, integer, timestamptz)
  from public, anon, authenticated;
-- Helper the console RPCs call as the signed-in user.
revoke all on function private.can_see_complaint(uuid) from public, anon;
grant execute on function private.can_see_complaint(uuid) to authenticated;

revoke all on function
  public.triage_preview(text),
  public.create_complaint(text, text, timestamptz, numeric, numeric, numeric, boolean, uuid, uuid),
  public.share_complaint_identity(uuid),
  public.complaint_timeline(uuid),
  public.claim_triage(integer),
  public.finish_triage(uuid, text, jsonb, text, boolean)
  from public, anon;
grant execute on function
  public.triage_preview(text),
  public.create_complaint(text, text, timestamptz, numeric, numeric, numeric, boolean, uuid, uuid),
  public.share_complaint_identity(uuid),
  public.complaint_timeline(uuid)
  to authenticated, service_role;
revoke all on function
  public.claim_triage(integer),
  public.finish_triage(uuid, text, jsonb, text, boolean)
  from authenticated;
grant execute on function
  public.claim_triage(integer),
  public.finish_triage(uuid, text, jsonb, text, boolean)
  to service_role;
