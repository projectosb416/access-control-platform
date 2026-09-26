'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createClient } from '@/lib/supabase/client'
import type { GuardRow } from './page'

/**
 * Guard list + add form + deactivate action.
 *
 * "Remove" means deactivate — status flips to 'inactive'. The guard row
 * stays in the database because shift history and access events reference
 * the guard. Removing the row would break every past access event tied to
 * that guard. Handoff §38.
 *
 * Deactivated guards stay visible in the list (greyed out) so admin can
 * see historical context. A filter chip at the top hides them by default.
 */

type StatusFilter = 'active' | 'all'

export function GuardsClient({
  organizationId,
  orgStatus,
  initialGuards,
}: {
  organizationId: string
  orgStatus: string
  initialGuards: GuardRow[]
}) {
  const router = useRouter()

  // Add form state
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<{ name: string; code: string } | null>(null)

  // List filter
  const [filter, setFilter] = useState<StatusFilter>('active')

  // Deactivate dialog
  const [deactivateTarget, setDeactivateTarget] = useState<GuardRow | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  const operational = orgStatus === 'active'

  const visibleGuards = initialGuards.filter((g) =>
    filter === 'active' ? g.status === 'active' : true,
  )

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setJustAdded(null)

    const trimmedName = fullName.trim()
    if (!trimmedName) {
      setError('Please enter the guard’s full name.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc(
        'create_guard_with_person',
        {
          p_organization_id: organizationId,
          p_full_name: trimmedName,
          p_phone: phone.trim() || null,
          p_email: email.trim() || null,
        },
      )

      if (rpcError) {
        setError(mapRpcError(rpcError.message))
        return
      }

      const row = Array.isArray(data) ? data[0] : data
      const code = (row?.guard_code as string) ?? ''

      setJustAdded({ name: trimmedName, code })
      setFullName('')
      setPhone('')
      setEmail('')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return
    setDeactivating(true)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('guard_profiles')
        .update({ status: 'inactive' })
        .eq('id', deactivateTarget.id)

      if (updateError) {
        setError('Could not deactivate. Please try again.')
        return
      }

      setDeactivateTarget(null)
      router.refresh()
    } catch {
      setError('Could not deactivate. Please try again.')
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Guards</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          People who process entry and exit at your gates. Each guard receives
          a Guard ID to use at the gate.
        </p>
      </header>

      {!operational ? (
        <div className="bg-amber-500/10 text-amber-900 dark:text-amber-200 mb-6 rounded-md border border-amber-500/30 px-4 py-3 text-sm">
          <strong className="font-medium">Subscription not yet active.</strong>{' '}
          You can see existing guards but cannot add new ones until your
          organization is active.
        </div>
      ) : null}

      {/* Filter */}
      <div className="mb-4 flex items-center gap-2">
        <FilterChip
          label="Active"
          value="active"
          current={filter}
          onSelect={setFilter}
        />
        <FilterChip
          label="All"
          value="all"
          current={filter}
          onSelect={setFilter}
        />
      </div>

      {/* Existing guards */}
      <section className="mb-8">
        {visibleGuards.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            {filter === 'active'
              ? 'No active guards yet. Add your first one below.'
              : 'No guards yet. Add your first one below.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleGuards.map((g) => {
              const inactive = g.status !== 'active'
              return (
                <li
                  key={g.id}
                  className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 ${
                    inactive ? 'bg-muted/10 opacity-60' : 'bg-muted/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{g.full_name}</p>
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      {g.guard_code}
                    </p>
                    {g.phone || g.email ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {[g.phone, g.email].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        inactive
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {g.status}
                    </span>
                    {!inactive && operational ? (
                      <button
                        type="button"
                        onClick={() => setDeactivateTarget(g)}
                        className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4"
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Add guard form */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
          Add a guard
        </h2>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-lg border p-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="guardFullName">Full name</Label>
            <Input
              id="guardFullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Samuel Adeyemi"
              disabled={!operational || submitting}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="guardPhone">
              Phone{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="guardPhone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +2348012345678"
              disabled={!operational || submitting}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="guardEmail">
              Email{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="guardEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. samuel@example.com"
              disabled={!operational || submitting}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {justAdded ? (
            <div className="bg-emerald-600/10 text-emerald-900 dark:text-emerald-200 rounded-md px-3 py-3 text-sm">
              <p className="font-medium">{justAdded.name} added.</p>
              <p className="mt-2">
                Guard ID:{' '}
                <span className="bg-background rounded px-2 py-0.5 font-mono font-medium">
                  {justAdded.code}
                </span>
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Share this with the guard. They enter it at the gate along
                with the shift code.
              </p>
            </div>
          ) : null}

          <div>
            <Button
              type="submit"
              disabled={!operational || submitting}
              className="h-11"
            >
              {submitting ? 'Adding…' : 'Add guard'}
            </Button>
          </div>
        </form>
      </section>

      {/* Deactivate confirmation */}
      <AlertDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {deactivateTarget?.full_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The guard can no longer start shifts. Their history stays in
              the platform — past access events and shifts remain visible.
              You can reactivate them later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDeactivate()
              }}
              disabled={deactivating}
            >
              {deactivating ? 'Deactivating…' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FilterChip({
  label,
  value,
  current,
  onSelect,
}: {
  label: string
  value: StatusFilter
  current: StatusFilter
  onSelect: (v: StatusFilter) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

function mapRpcError(message: string): string {
  if (message.includes('NOT_AUTHORIZED')) {
    return 'You don’t have permission to add guards.'
  }
  if (message.includes('SUBSCRIPTION_INACTIVE')) {
    return 'Your organization is not active yet. Complete setup or choose a plan first.'
  }
  if (message.includes('FULL_NAME_REQUIRED')) {
    return 'Please enter the guard’s full name.'
  }
  if (message.includes('NOT_AUTHENTICATED')) {
    return 'Your session has expired. Please log in again.'
  }
  return 'Could not add the guard. Please try again.'
}
