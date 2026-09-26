'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * Setup wizard — four steps, in-memory state, one atomic submit.
 *
 *   1. Organization — name, type
 *   2. You           — admin's full name
 *   3. Property      — property name, optional unit label
 *   4. Review        — confirm and submit
 *
 * Nothing hits the database until step 4. The whole wizard calls
 * setup_organization() exactly once, on the final Confirm. That function
 * is atomic — all five rows (org, admin person, admin membership, property,
 * unit) commit together or not at all.
 *
 * See docs/phase-8/device-classes.md. Composition works on both Handheld
 * and Desk — single column, capped width.
 */

type OrgType = 'residential' | 'workplace' | 'other'

interface WizardData {
  orgName: string
  orgType: OrgType
  adminFullName: string
  propertyName: string
  unitLabel: string
}

const EMPTY: WizardData = {
  orgName: '',
  orgType: 'residential',
  adminFullName: '',
  propertyName: '',
  unitLabel: '',
}

const TOTAL_STEPS = 4
const STEP_LABELS = ['Organization', 'You', 'Property', 'Review']

export function SetupWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((d) => ({ ...d, [key]: value }))
  }

  function canAdvance(): boolean {
    switch (step) {
      case 1:
        return data.orgName.trim().length > 0
      case 2:
        return data.adminFullName.trim().length > 0
      case 3:
        return data.propertyName.trim().length > 0
      case 4:
        return true
      default:
        return false
    }
  }

  function next() {
    if (!canAdvance()) return
    setError(null)
    setStep((s) => Math.min(TOTAL_STEPS, s + 1))
  }

  async function back() {
    if (step === 1) {
      // Leaving the wizard from step 1 means leaving the app entirely —
      // without an organization the admin has nowhere else to go.
      // Sign out and return to login. (Navigating to /admin would loop,
      // since /admin redirects back here when no membership exists.)
      try {
        const supabase = createClient()
        await supabase.auth.signOut()
      } catch {
        // ignore
      }
      router.replace('/admin/login')
      return
    }
    setError(null)
    setStep((s) => Math.max(1, s - 1))
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        'setup_organization',
        {
          p_org_name: data.orgName.trim(),
          p_org_type: data.orgType,
          p_admin_full_name: data.adminFullName.trim(),
          p_property_name: data.propertyName.trim(),
          p_unit_label: data.unitLabel.trim() || null,
        },
      )

      if (rpcError) {
        setError(mapSetupError(rpcError.message))
        return
      }

      // Success — the org is provisioning. Redirect to /admin which will
      // route to the plan selection step in a later item.
      router.replace('/admin')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up your organization
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Four quick steps. You can review everything before confirming.
        </p>
      </header>

      <ProgressIndicator current={step} total={TOTAL_STEPS} labels={STEP_LABELS} />

      <div className="mt-8 flex-1">
        {step === 1 && <StepOrganization data={data} update={update} />}
        {step === 2 && <StepAdmin data={data} update={update} />}
        {step === 3 && <StepProperty data={data} update={update} />}
        {step === 4 && <StepReview data={data} />}
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mt-4 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={back}
          disabled={submitting}
        >
          {step === 1 ? 'Log out' : 'Back'}
        </Button>

        {step < TOTAL_STEPS ? (
          <Button
            type="button"
            onClick={next}
            disabled={!canAdvance() || submitting}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="min-w-[140px]"
          >
            {submitting ? 'Creating…' : 'Confirm'}
          </Button>
        )}
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------

function ProgressIndicator({
  current,
  total,
  labels,
}: {
  current: number
  total: number
  labels: string[]
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1
        const isCurrent = n === current
        const isPast = n < current
        return (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                isCurrent
                  ? 'bg-foreground text-background'
                  : isPast
                    ? 'bg-foreground/20 text-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isPast ? '✓' : n}
            </div>
            <span
              className={`hidden text-xs sm:inline ${
                isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              {labels[i]}
            </span>
            {n < total ? (
              <div className="bg-muted h-px flex-1" aria-hidden />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

type UpdateFn = <K extends keyof WizardData>(
  key: K,
  value: WizardData[K],
) => void

function StepOrganization({
  data,
  update,
}: {
  data: WizardData
  update: UpdateFn
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="orgName">Organization name</Label>
        <Input
          id="orgName"
          value={data.orgName}
          onChange={(e) => update('orgName', e.target.value)}
          placeholder="e.g. Green Valley Estate"
          autoFocus
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">
          This appears throughout the platform. You can change it later.
        </p>
      </div>

      <div className="grid gap-2">
        <Label>Organization type</Label>
        <div className="flex flex-col gap-2">
          <RadioOption
            value="residential"
            label="Residential"
            hint="Estate, apartment building, or single home."
            current={data.orgType}
            onSelect={(v) => update('orgType', v as OrgType)}
          />
          <RadioOption
            value="workplace"
            label="Workplace"
            hint="Office, business park, or company site."
            current={data.orgType}
            onSelect={(v) => update('orgType', v as OrgType)}
          />
          <RadioOption
            value="other"
            label="Other"
            hint="School, church, hospital, or anything else."
            current={data.orgType}
            onSelect={(v) => update('orgType', v as OrgType)}
          />
        </div>
      </div>
    </section>
  )
}

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

function StepAdmin({
  data,
  update,
}: {
  data: WizardData
  update: UpdateFn
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="adminFullName">Your full name</Label>
        <Input
          id="adminFullName"
          value={data.adminFullName}
          onChange={(e) => update('adminFullName', e.target.value)}
          placeholder="e.g. Adebayo Ogundimu"
          autoFocus
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">
          Your name appears on activity logs and notifications.
        </p>
      </div>
    </section>
  )
}

function StepProperty({
  data,
  update,
}: {
  data: WizardData
  update: UpdateFn
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="propertyName">Property name</Label>
        <Input
          id="propertyName"
          value={data.propertyName}
          onChange={(e) => update('propertyName', e.target.value)}
          placeholder="e.g. Green Valley Estate"
          autoFocus
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">
          Usually the same as the organization. Different if you run
          multiple sites under one organization.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="unitLabel">
          First unit label{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="unitLabel"
          value={data.unitLabel}
          onChange={(e) => update('unitLabel', e.target.value)}
          placeholder="e.g. House 1, Flat 24, Office 2B"
          className="h-11"
        />
        <p className="text-muted-foreground text-xs">
          Leave blank if this is a single dwelling with no sub-units. Otherwise
          use the label your estate uses — House 1, Flat B204, Block C /
          Unit 3, whatever fits. Add the rest later.
        </p>
      </div>
    </section>
  )
}

function StepReview({ data }: { data: WizardData }) {
  return (
    <section className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Check everything below. Tapping Confirm creates your organization.
      </p>

      <dl className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-5 text-sm">
        <ReviewRow label="Organization" value={data.orgName} />
        <ReviewRow label="Type" value={orgTypeLabel(data.orgType)} />
        <ReviewRow label="Your name" value={data.adminFullName} />
        <ReviewRow label="Property" value={data.propertyName} />
        <ReviewRow
          label="First unit"
          value={data.unitLabel || '—'}
          muted={!data.unitLabel}
        />
      </dl>
    </section>
  )
}

function ReviewRow({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd className={`text-right ${muted ? 'text-muted-foreground' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function orgTypeLabel(t: OrgType): string {
  switch (t) {
    case 'residential':
      return 'Residential'
    case 'workplace':
      return 'Workplace'
    case 'other':
      return 'Other'
  }
}

function mapSetupError(message: string): string {
  if (message.includes('NOT_AUTHENTICATED')) {
    return 'Your session has expired. Please log in again.'
  }
  if (message.includes('ORG_NAME_REQUIRED')) {
    return 'Please enter an organization name.'
  }
  if (message.includes('INVALID_ORG_TYPE')) {
    return 'Please choose an organization type.'
  }
  if (message.includes('ADMIN_NAME_REQUIRED')) {
    return 'Please enter your full name.'
  }
  if (message.includes('PROPERTY_NAME_REQUIRED')) {
    return 'Please enter a property name.'
  }
  return 'Could not create your organization. Please try again.'
}
