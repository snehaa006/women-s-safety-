-- Phase 3, step 2d: reporting an AI triage answer (service role only).
-- p_outcome: 'done' with p_result {category, severity, confidence, signals, rationale,
-- legal_tags, provider, model}; 'skipped' when no model is configured; 'failed' with p_retry.
-- The answer can raise severity, never lower it below the rules floor or an officer's setting;
-- unknown categories fall back to the rules' and severity is clamped to 1-5.
create function public.finish_triage(
  p_complaint_id uuid,
  p_outcome      text,
  p_result       jsonb default null,
  p_error        text default null,
  p_retry        boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints;
  v_severity  smallint;
  v_category  text;
  v_baseline  smallint;
  v_ai        jsonb;
  v_error     text := p_error;
  v_outcome   text := p_outcome;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id for update;
  if not found or v_complaint.triage_state <> 'pending' then
    return 'ignored';
  end if;

  if v_outcome = 'skipped' then
    update public.complaints set triage_state = 'skipped', triage_claimed_at = null
     where id = p_complaint_id;
    perform private.ledger_append(
      p_action       => 'complaint.ai_skipped',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object('reason', coalesce(left(v_error, 200), 'No AI model is set up'))
    );
    return 'skipped';
  end if;

  if v_outcome = 'done' then
    v_severity := case when jsonb_typeof(p_result -> 'severity') = 'number'
                       then least(greatest((p_result ->> 'severity')::numeric, 1), 5)::smallint end;
    if v_severity is null then
      v_outcome := 'failed';
      v_error := 'The model returned no severity';
    end if;
  end if;

  if v_outcome <> 'done' then
    if p_retry and v_complaint.triage_attempts < 3 then
      update public.complaints set triage_claimed_at = null where id = p_complaint_id;
      return 'retry';
    end if;
    update public.complaints set triage_state = 'failed', triage_claimed_at = null
     where id = p_complaint_id;
    perform private.ledger_append(
      p_action       => 'complaint.ai_failed',
      p_subject_type => 'complaint',
      p_subject_id   => p_complaint_id,
      p_payload      => jsonb_build_object('reason', coalesce(left(v_error, 200), 'Unknown error'))
    );
    return 'failed';
  end if;

  v_category := case when exists (select 1 from private.triage_categories t
                                  where t.category = p_result ->> 'category')
                     then p_result ->> 'category' else v_complaint.rules ->> 'category' end;
  v_baseline := greatest((v_complaint.rules ->> 'severity')::smallint, v_severity);
  v_ai := jsonb_build_object(
    'category', v_category,
    'severity', v_severity,
    'confidence', case when jsonb_typeof(p_result -> 'confidence') = 'number'
                       then least(greatest((p_result ->> 'confidence')::numeric, 0), 1) end,
    'signals', coalesce(p_result -> 'signals', '[]'::jsonb),
    'rationale', left(p_result ->> 'rationale', 600),
    'legal_tags', coalesce(p_result -> 'legal_tags', '[]'::jsonb),
    'provider', left(p_result ->> 'provider', 40),
    'model', left(p_result ->> 'model', 80),
    'rules_floor', (v_complaint.rules ->> 'severity')::smallint,
    'final', v_baseline,
    'version', 'triage-v1',
    'at', now()
  );

  update public.complaints
     set ai = v_ai,
         triage_state = 'done',
         triage_claimed_at = null,
         category = v_category,
         baseline_severity = greatest(baseline_severity, v_baseline),
         severity = greatest(severity, v_baseline)
   where id = p_complaint_id;

  perform private.ledger_append(
    p_action       => 'complaint.ai_triaged',
    p_subject_type => 'complaint',
    p_subject_id   => p_complaint_id,
    p_payload      => jsonb_build_object(
                        'category', v_category,
                        'model_severity', v_severity,
                        'rules_floor', (v_complaint.rules ->> 'severity')::smallint,
                        'severity', greatest(v_complaint.severity, v_baseline),
                        'raised', greatest(v_complaint.severity, v_baseline) > v_complaint.severity,
                        'provider', v_ai ->> 'provider',
                        'model', v_ai ->> 'model')
  );
  perform private.reset_complaint_sla(p_complaint_id, now());
  return 'done';
end;
$$;
