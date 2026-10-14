import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SettingsClient } from './settings-client'

/**
 * /admin/(app)/settings — organisation settings.
 *
 * Server Component. Reads the org row for the current admin and hands
 * the editable fields to a client form.
 *
 * Write path: update_organization_settings() — SECURITY DEFINER,
 * is_org_admin gated (migration 0076). RLS on organizations is
 * SELECT-only after the policy drop in the same migration.
 *
 * Editable subset (v1): name / display_name (mirrored), organization_type.
 * Not exposed: status (payment lifecycle), created_at, updated_at.
 * Not present as columns: timezone, notification prefs, branding.
 */

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    redirect('/admin/setup')
  }

  const organizationId = membership.organization_id as string

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, display_name, organization_type, status, created_at')
    .eq('id', organizationId)
    .maybeSingle()

  if (!org) {
    redirect('/admin/setup')
  }

  return (
    <SettingsClient
      organizationId={organizationId}
      initialName={org.name as string}
      initialType={org.organization_type as string}
      organizationStatus={org.status as string}
      createdAt={org.created_at as string}
    />
  )
}
