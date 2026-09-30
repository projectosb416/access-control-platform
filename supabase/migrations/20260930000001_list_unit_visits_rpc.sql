-- ============================================================================
-- Migration 0055: list_unit_visits RPC
-- ============================================================================
-- Purpose:
--   Provide a SECURITY DEFINER function for residents to fetch recent visits
--   to their unit. This bypasses RLS complexity and ensures a consistent,
--   auditable read path, matching the pattern of list_guest_pins_for_unit.
--
-- Design notes:
--   - Returns session_id, visitor_name, entered_at, exited_at, status.
--   - Filters by scope_unit_id = p_unit_id.
--   - Limits to 20 most recent entries.
--   - authorization_id is NOT NULL, making the join to authorizations safe.
--   - Joins units -> properties to get organization_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_unit_visits(p_unit_id uuid)
RETURNS TABLE (
    session_id uuid,
    visitor_name text,
    entered_at timestamptz,
    exited_at timestamptz,
    status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
BEGIN
    -- Validate unit exists and get its organization_id via properties
    SELECT p.organization_id INTO v_org_id 
    FROM public.units u
    JOIN public.properties p ON p.id = u.property_id
    WHERE u.id = p_unit_id;
    
    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        s.id AS session_id,
        per.full_name AS visitor_name,
        s.entered_at,
        s.exited_at,
        s.status
    FROM public.access_sessions s
    JOIN public.authorizations a ON a.id = s.authorization_id
    JOIN public.people per ON per.id = s.person_id
    WHERE a.scope_unit_id = p_unit_id
      AND s.organization_id = v_org_id
    ORDER BY s.entered_at DESC
    LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.list_unit_visits(uuid) IS 
  'SECURITY DEFINER function to list recent visits for a specific unit. Returns max 20 rows.';

-- Grant execute to authenticated users (residents)
GRANT EXECUTE ON FUNCTION public.list_unit_visits(uuid) TO authenticated;
