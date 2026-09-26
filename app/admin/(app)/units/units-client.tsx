'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import type { UnitRow } from './page'

/**
 * Units — list, single-add, bulk-add with preview.
 *
 * Bulk is the primary path (handoff §9). Preview shows exactly what will
 * be created, marks rows that already exist, and only commits on Confirm.
 * No partial writes — a single insert of the whole batch.
 *
 * Batch cap: 500 units per submit. Beyond that is a typo, not a use case.
 */

type Mode = 'single' | 'bulk'
type StatusFilter = 'active' | 'all'

const BULK_MAX = 500

interface PropertyOption {
  id: string
  name: string
}

interface PreviewRow {
  label: string
  conflict: boolean
}

export function UnitsClient({
  orgStatus,
  properties,
  initialUnits,
  occupiedUnitIds,
}: {
  orgStatus: string
  properties: PropertyOption[]
  initialUnits: UnitRow[]
  occupiedUnitIds: string[]
}) {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('single')
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')

  // Single-add
  const [singleLabel, setSingleLabel] = useState('')
  const [singleNotes, setSingleNotes] = useState('')

  // Bulk-add
  const [bulkPrefix, setBulkPrefix] = useState('')
  const [bulkStart, setBulkStart] = useState('1')
  const [bulkEnd, setBulkEnd] = useState('10')
  const [bulkNotes, setBulkNotes] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const [filter, setFilter] = useState<StatusFilter>('active')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<number | null>(null)

  const operational = orgStatus === 'active'
  const hasProperties = properties.length > 0

  const occupiedSet = useMemo(
    () => new Set(occupiedUnitIds),
    [occupiedUnitIds],
  )

  const existingLabels = useMemo(() => {
    const set = new Set<string>()
    for (const u of initialUnits) {
      if (u.property_id === propertyId) {
        set.add(u.label.trim().toLowerCase())
      }
    }
    return set
  }, [initialUnits, propertyId])

  const visibleUnits = initialUnits.filter((u) => {
    if (u.property_id !== propertyId) return false
    if (filter === 'active') return u.status === 'active'
    return true
  })

  // Bulk preview — pure computation from state. Capped at BULK_MAX.
  const bulkPreview = useMemo<PreviewRow[]>(() => {
    const prefix = bulkPrefix.trim()
    const start = parseInt(bulkStart, 10)
    const end = parseInt(bulkEnd, 10)
    if (!prefix || !Number.isInteger(start) || !Number.isInteger(end)) return []
    if (end < start) return []
    if (end - start + 1 > BULK_MAX) return []

    const rows: PreviewRow[] = []
    for (let n = start; n <= end; n++) {
      const label = `${prefix} ${n}`
      rows.push({
        label,
        conflict: existingLabels.has(label.trim().toLowerCase()),
      })
    }
    return rows
  }, [bulkPrefix, bulkStart, bulkEnd, existingLabels])

  const bulkCount = bulkPreview.length
  const bulkConflicts = bulkPreview.filter((r) => r.conflict).length
  const bulkClean = bulkCount - bulkConflicts

  function clearMessages() {
    setError(null)
    setNotice(null)
    setJustAdded(null)
  }

  async function handleSingleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    clearMessages()

    const label = singleLabel.trim()
    if (!propertyId) {
      setError('Please choose a property.')
      return
    }
    if (!label) {
      setError('Please enter a unit label.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase.from('units').insert({
        property_id: propertyId,
        label,
        notes: singleNotes.trim() || null,
        status: 'active',
      })

      if (insertError) {
        setError(mapInsertError(insertError.message))
        return
      }

      setNotice(`${label} added.`)
      setSingleLabel('')
      setSingleNotes('')
      setJustAdded(1)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function openBulkPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    clearMessages()
    if (!propertyId) {
      setError('Please choose a property.')
      return
    }
    if (bulkCount === 0) {
      setError('Please enter a valid pattern and range.')
      return
    }
    if (bulkClean === 0) {
      setError('All units in this range already exist. Adjust the range.')
      return
    }
    setPreviewOpen(true)
  }

  async function confirmBulkInsert() {
    clearMessages()
    const rows = bulkPreview
      .filter((r) => !r.conflict)
      .map((r) => ({
        property_id: propertyId,
        label: r.label,
        notes: bulkNotes.trim() || null,
        status: 'active',
      }))

    if (rows.length === 0) {
      setError('No new units to create.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase.from('units').insert(rows)

      if (insertError) {
        setError(mapInsertError(insertError.message))
        setPreviewOpen(false)
        return
      }

      setNotice(`${rows.length} unit${rows.length === 1 ? '' : 's'} created.`)
      setBulkPrefix('')
      setBulkNotes('')
      setPreviewOpen(false)
      setJustAdded(rows.length)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
      setPreviewOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (!hasProperties) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Units</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Units belong to a property. Create a property first.
          </p>
        </header>
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No active property found. Complete organization setup to create one.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Units</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Units within your property. Use bulk creation for estates with many
          houses, flats, or offices.
        </p>
      </header>

      {!operational ? (
        <div className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <strong className="font-medium">Subscription not yet active.</strong>{' '}
          You can see existing units but cannot add new ones until your
          organization is active.
        </div>
      ) : null}

      {/* Property selector */}
      {properties.length > 1 ? (
        <div className="mb-4 grid gap-2">
          <Label htmlFor="propertySelect">Property</Label>
          <select
            id="propertySelect"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="border-input bg-background h-11 max-w-md rounded-md border px-3 text-sm"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Filter */}
      <div className="mb-4 flex items-center gap-2">
        <FilterChip label="Active" value="active" current={filter} onSelect={setFilter} />
        <FilterChip label="All" value="all" current={filter} onSelect={setFilter} />
      </div>

      {/* Existing units */}
      <section className="mb-8">
        {visibleUnits.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No units yet for this property. Add your first one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleUnits.map((u) => {
              const occupied = occupiedSet.has(u.id)
              const inactive = u.status !== 'active'
              return (
                <li
                  key={u.id}
                  className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 ${
                    inactive ? 'bg-muted/10 opacity-70' : 'bg-muted/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{u.label}</p>
                    {u.notes ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {u.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        occupied
                          ? 'bg-blue-600/15 text-blue-800 dark:text-blue-300'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {occupied ? 'Occupied' : 'Vacant'}
                    </span>
                    {inactive ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {u.status}
                      </span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Add form */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
          Add units
        </h2>

        <div className="rounded-lg border p-5">
          {/* Mode tabs */}
          <div className="bg-muted mb-4 flex gap-1 rounded-lg p-1">
            <ModeTab label="Single" value="single" current={mode} onSelect={setMode} />
            <ModeTab label="Bulk" value="bulk" current={mode} onSelect={setMode} />
          </div>

          {mode === 'single' ? (
            <form onSubmit={handleSingleSubmit} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="singleLabel">Unit label</Label>
                <Input
                  id="singleLabel"
                  value={singleLabel}
                  onChange={(e) => setSingleLabel(e.target.value)}
                  placeholder="e.g. House 42, Flat 204, Office 2B"
                  disabled={!operational || submitting}
                  className="h-11"
                />
                <p className="text-muted-foreground text-xs">
                  Use whatever your estate uses — House 42, Flat B204, Suite 3A.
                  Must be unique within this property.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="singleNotes">
                  Notes{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="singleNotes"
                  value={singleNotes}
                  onChange={(e) => setSingleNotes(e.target.value)}
                  placeholder="e.g. corner unit"
                  disabled={!operational || submitting}
                  className="h-11"
                />
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={!operational || submitting}
                  className="h-11"
                >
                  {submitting ? 'Adding…' : 'Add unit'}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={openBulkPreview} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="bulkPrefix">Label prefix</Label>
                <Input
                  id="bulkPrefix"
                  value={bulkPrefix}
                  onChange={(e) => setBulkPrefix(e.target.value)}
                  placeholder="e.g. House, Flat, Unit, Block B / Flat"
                  disabled={!operational || submitting}
                  className="h-11"
                />
                <p className="text-muted-foreground text-xs">
                  A number will be appended. &ldquo;House&rdquo; + 1 to 200 creates
                  House 1, House 2, … House 200.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="bulkStart">Start</Label>
                  <Input
                    id="bulkStart"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={bulkStart}
                    onChange={(e) => setBulkStart(e.target.value)}
                    disabled={!operational || submitting}
                    className="h-11"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bulkEnd">End</Label>
                  <Input
                    id="bulkEnd"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={bulkEnd}
                    onChange={(e) => setBulkEnd(e.target.value)}
                    disabled={!operational || submitting}
                    className="h-11"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="bulkNotes">
                  Notes{' '}
                  <span className="text-muted-foreground font-normal">(optional, applied to all)</span>
                </Label>
                <Input
                  id="bulkNotes"
                  value={bulkNotes}
                  onChange={(e) => setBulkNotes(e.target.value)}
                  placeholder="e.g. phase 1"
                  disabled={!operational || submitting}
                  className="h-11"
                />
              </div>

              <div className="text-muted-foreground text-xs">
                {bulkCount > 0
                  ? `${bulkCount} unit${bulkCount === 1 ? '' : 's'} would be created${
                      bulkConflicts > 0
                        ? `, ${bulkConflicts} already exist`
                        : ''
                    }.`
                  : 'Enter a valid prefix and range.'}
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={!operational || submitting || bulkCount === 0}
                  className="h-11"
                >
                  Preview
                </Button>
              </div>
            </form>
          )}

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive mt-4 rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="bg-muted mt-4 rounded-md px-3 py-2 text-sm">{notice}</p>
          ) : null}

          {justAdded ? (
            <div className="mt-4 rounded-md bg-emerald-600/10 px-3 py-3 text-sm text-emerald-900 dark:text-emerald-200">
              <p className="font-medium">
                {justAdded} unit{justAdded === 1 ? '' : 's'} added.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* Bulk preview overlay */}
      {previewOpen ? (
        <div className="bg-background/80 fixed inset-0 z-40 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-background flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border shadow-lg">
            <div className="border-b px-5 py-4">
              <h3 className="text-lg font-semibold tracking-tight">
                Preview — {bulkCount} unit{bulkCount === 1 ? '' : 's'}
              </h3>
              <p className="text-muted-foreground mt-1 text-xs">
                {bulkConflicts > 0
                  ? `${bulkClean} new · ${bulkConflicts} already exist (skipped)`
                  : 'All new — nothing existing is affected.'}
              </p>
            </div>

            <div className="overflow-auto px-5 py-3">
              <ul className="flex flex-col gap-1">
                {bulkPreview.map((row, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                      row.conflict
                        ? 'bg-muted/40 text-muted-foreground line-through'
                        : ''
                    }`}
                  >
                    <span className="truncate font-mono">{row.label}</span>
                    {row.conflict ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide">
                        exists
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 border-t px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPreviewOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmBulkInsert}
                disabled={submitting || bulkClean === 0}
              >
                {submitting
                  ? 'Creating…'
                  : `Create ${bulkClean} unit${bulkClean === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

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
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function ModeTab({
  label,
  value,
  current,
  onSelect,
}: {
  label: string
  value: Mode
  current: Mode
  onSelect: (v: Mode) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function mapInsertError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('row-level security') || lower.includes('permission')) {
    return 'Your organization is not active yet. Complete setup or choose a plan first.'
  }
  if (lower.includes('units_unique_label_per_property') || lower.includes('duplicate')) {
    return 'A unit with this label already exists in this property. Choose a different label.'
  }
  if (lower.includes('units_label_not_blank')) {
    return 'Unit label cannot be blank.'
  }
  return 'Could not add the units. Please try again.'
}
