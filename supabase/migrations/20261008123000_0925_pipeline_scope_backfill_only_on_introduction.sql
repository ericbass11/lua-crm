-- 0925 — preserve deliberate empty pipeline scope on baseline reapplication.
-- The canonical baseline substitutes this guard at the original 0125 ADD/backfill.
-- A forward migration cannot undo any widening already committed by an old baseline.
DO $pipeline_initial_scope$
DECLARE introduced boolean;
BEGIN
  LOCK TABLE public.ai_agent_versions IN ACCESS EXCLUSIVE MODE;
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.ai_agent_versions'::regclass
      AND attname='pipeline_ids' AND attnum>0 AND NOT attisdropped
  ) INTO introduced;
  IF introduced THEN
    ALTER TABLE public.ai_agent_versions
      ADD COLUMN pipeline_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
    UPDATE public.ai_agent_versions v
      SET pipeline_ids=sub.funis
      FROM (
        SELECT ca.actor_agent_id AS agent_id,
               array_agg(DISTINCT l.pipeline_id) AS funis
        FROM public.crm_lead_activities ca
        JOIN public.crm_leads l ON l.id=ca.lead_id
        WHERE ca.actor_agent_id IS NOT NULL
        GROUP BY ca.actor_agent_id
      ) sub
      WHERE v.agent_id=sub.agent_id AND v.pipeline_ids='{}'::uuid[];
  END IF;
END $pipeline_initial_scope$;
