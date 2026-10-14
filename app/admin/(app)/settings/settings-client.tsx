'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * Organisation settings — Client Component.
 *
 * Three editable fields: name (mirrored to display_name server-side),
 * organization_type. Status and created_at are read-only displays.
 *
 * Write path: update_organization_settings() — SECURITY DEFINER,
 * is_org_admin gated (migration 0076). RLS on organizations is
 * SELECT-only after the policy drop in the same migration.
 *
 * On success: router.refresh() re-runs the Server Component so the
 * header/panels reflect the new name without a manual reload.
 */

type OrgType = 'residential' | 'workplace' | 'other'

const ORG_TYPES: Array<{ value: OrgType; label: string; hint: string }> = [
  {
    value: 'residential',
    label: 'Residential',
    hint: 'Estate, apartment building, or single home.',
  },
  {
    value: 'workplace',
    label: 'Workplace',
    hint: 'Office, business park, or company site.',
  },
  {
    value: 'other',
    label: 'Other',
    hint: 'School, church, hospital, or anything else.',
  },
]

export function SettingsClient({
  organizationId,
  initialName,
  initialType,
  organizationStatus,
  createdAt,
}: {
  organizationId: string
  initialName: string
  initialType: string
  organizationStatus: string
  createdAt: string
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [orgType, setOrgType] = useState<OrgType>(initialType as OrgType)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const trimmed = name.trim()
  const dirty = trimmed !== initialName.trim() || orgType !== initialType
  const canSubmit = dirty && trimmed.length > 0 && !submitting

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        'update_organization_settings',
        {
          p_organization_id: organizationId,
          p_name: trimmed,
          p_organization_type: orgType,
        },
      )
      if (rpcError) {
        setError(mapSettingsError(rpcError.message))
        return
      }
      setSuccess(true)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Update your organisation&rsquo;s name and type.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="grid gap-2">
          <Label htmlFor="orgName">Organization name</Label>
          <Input
            id="orgName"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSuccess(false)
            }}
            placeholder="e.g. Green Valley Estate"
            className="h-11"
          />
          <p className="text-muted-foreground text-xs">
            This appears throughout the platform.
          </p>
        </div>

        <div className="grid gap-2">
          <Label>Organization type</Label>
          <div className="flex flex-col gap-2">
            {ORG_TYPES.map((t) => (
              <RadioOption
                key={t.value}
                value={t.value}
                label={t.label}
                hint={t.hint}
                current={orgType}
                onSelect={(v) => {
                  setOrgType(v as OrgType)
                  setSuccess(false)
                }}
              />
            ))}
          </div>
        </div>

        <div className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-5 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              Status
            </span>
            <span className="font-mono text-xs">{organizationStatus}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              Created
            </span>
            <span className="text-muted-foreground text-xs">
              {formatCreatedAt(createdAt)}
            </span>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        {success ? (
          <p
            role="status"
            className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm"
          >
            Settings saved.
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!canSubmit}
            className="min-w-[120px]"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </main>
  )
}

// ---------------------------------------------------------------------------

function RadioOption({
  value,
  label,
  hint,
  current,
  onSelect,
}: {
  value: string
  label: string
  hint: string
  current: string
  onSelect: (v: string) => void
}) {
  const selected = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left transition-colors ${
        selected ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/50'
      }`}
      aria-pressed={selected}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-muted-foreground text-xs">{hint}</span>
    </button>
  )
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

function mapSettingsError(message: string): string {
  if (message.includes('NOT_ORG_ADMIN')) {
    return 'You do not have permission to change these settings.'
  }
  if (message.includes('ORG_NAME_REQUIRED')) {
    return 'Please enter an organization name.'
  }
  if (message.includes('INVALID_ORG_TYPE')) {
    return 'Please choose an organization type.'
  }
  if (message.includes('NOT_AUTHENTICATED')) {
    return 'Your session has expired. Please log in again.'
  }
  return 'Could not save your settings. Please try again.'
}
