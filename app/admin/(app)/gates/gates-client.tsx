'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import type { GateRow } from './page'

/**
 * Gate list + add form. Client-side because it manages form state and
 * performs the insert against RLS through the browser Supabase client.
 *
 * After a successful insert, router.refresh() re-runs the Server
 * Component to fetch the fresh list — no client-side list mutation, no
 * risk of the client and server disagreeing about what exists.
 *
 * If the org is not operational, the form is disabled with a clear
 * explanation. The database would reject the insert anyway; we just say
 * so up front rather than letting the user hit a permission error.
 */

const MAX_CAPACITY = 100

export function GatesClient({
  organizationId,
  orgStatus,
  initialGates,
}: {
  organizationId: string
  orgStatus: string
  initialGates: GateRow[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const operational = orgStatus === 'active'

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setJustAdded(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Please enter a gate name.')
      return
    }

    const parsedCapacity = parseInt(capacity, 10)
    if (
      !Number.isInteger(parsedCapacity) ||
      parsedCapacity < 1 ||
      parsedCapacity > MAX_CAPACITY
    ) {
      setError(`Maximum guards must be between 1 and ${MAX_CAPACITY}.`)
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase.from('gates').insert({
        organization_id: organizationId,
        name: trimmedName,
        description: description.trim() || null,
        max_active_guards: parsedCapacity,
        status: 'active',
      })

      if (insertError) {
        setError(mapInsertError(insertError.message))
        return
      }

      setJustAdded(trimmedName)
      setName('')
      setDescription('')
      setCapacity('1')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Gates</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Physical access points for your property. Each gate can accept
          multiple guards at once up to its capacity.
        </p>
      </header>

      {!operational ? (
        <div className="bg-amber-500/10 text-amber-900 dark:text-amber-200 mb-6 rounded-md border border-amber-500/30 px-4 py-3 text-sm">
          <strong className="font-medium">Subscription not yet active.</strong>{' '}
          You can see existing gates but cannot add new ones until your
          organization is active. Complete setup or choose a plan to continue.
        </div>
      ) : null}

      {/* Existing gates */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Existing gates
        </h2>

        {initialGates.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No gates yet. Add your first one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {initialGates.map((g) => (
              <li
                key={g.id}
                className="bg-muted/30 flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
                  {g.description ? (
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {g.description}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">
                    Capacity
                  </p>
                  <p className="text-sm font-medium">{g.max_active_guards}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add gate form */}
      <section>
        <h2 className="mb-3 text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Add a gate
        </h2>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-lg border p-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="gateName">Gate name</Label>
            <Input
              id="gateName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gate 1 Main Gate"
              disabled={!operational || submitting}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="gateDesc">
              Description{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="gateDesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Front of property, facing UNILAG"
              disabled={!operational || submitting}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="gateCapacity">Maximum active guards</Label>
            <Input
              id="gateCapacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_CAPACITY}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              disabled={!operational || submitting}
              className="h-11 max-w-[160px]"
            />
            <p className="text-muted-foreground text-xs">
              How many guards can be on shift at this gate at the same time.
              Enforced by the platform.
            </p>
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
            <p className="bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 rounded-md px-3 py-2 text-sm">
              {justAdded} added.
            </p>
          ) : null}

          <div>
            <Button
              type="submit"
              disabled={!operational || submitting}
              className="h-11"
            >
              {submitting ? 'Adding…' : 'Add gate'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function mapInsertError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('row-level security') || lower.includes('permission')) {
    return 'Your organization is not active yet. Complete setup or choose a plan first.'
  }
  if (lower.includes('unique') || lower.includes('duplicate')) {
    return 'A gate with this name already exists. Choose a different name.'
  }
  if (lower.includes('check') || lower.includes('constraint')) {
    return 'Please check the values entered.'
  }
  return 'Could not add the gate. Please try again.'
}
