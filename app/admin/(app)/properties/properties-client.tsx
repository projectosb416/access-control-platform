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
import type { PropertyRow } from './page'

/**
 * Properties list + add + edit + archive.
 *
 * Location fields: country is fixed to NG in v1 (not user-selectable).
 * State is a dropdown — Nigerian 36 + FCT. Free text would destroy filter
 * quality. City is free text — no canonical list.
 */

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue',
  'Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT',
  'Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi',
  'Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
  'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
] as const

type StatusFilter = 'active' | 'all'

interface FormState {
  name: string
  address: string
  city: string
  state: string
}

const EMPTY_FORM: FormState = { name: '', address: '', city: '', state: '' }

export function PropertiesClient({
  organizationId,
  orgStatus,
  initialProperties,
}: {
  organizationId: string
  orgStatus: string
  initialProperties: PropertyRow[]
}) {
  const router = useRouter()

  const [filter, setFilter] = useState<StatusFilter>('active')

  // Add form
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)

  // Edit dialog
  const [editTarget, setEditTarget] = useState<PropertyRow | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Archive dialog
  const [archiveTarget, setArchiveTarget] = useState<PropertyRow | null>(null)
  const [archiving, setArchiving] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const operational = orgStatus === 'active'

  const visibleProperties = initialProperties.filter((p) =>
    filter === 'active' ? p.status === 'active' : true,
  )

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    clearMessages()

    const name = addForm.name.trim()
    if (!name) {
      setError('Please enter a property name.')
      return
    }

    setAdding(true)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase.from('properties').insert({
        organization_id: organizationId,
        name,
        address: addForm.address.trim() || null,
        city: addForm.city.trim() || null,
        state: addForm.state.trim() || null,
        country: 'NG',
        status: 'active',
      })

      if (insertError) {
        setError(mapInsertError(insertError.message))
        return
      }

      setNotice(`${name} added.`)
      setAddForm(EMPTY_FORM)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setAdding(false)
    }
  }

  function openEdit(p: PropertyRow) {
    setEditTarget(p)
    setEditForm({
      name: p.name,
      address: p.address ?? '',
      city: p.city ?? '',
      state: p.state ?? '',
    })
  }

  async function handleEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editTarget) return
    clearMessages()

    const name = editForm.name.trim()
    if (!name) {
      setError('Please enter a property name.')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('properties')
        .update({
          name,
          address: editForm.address.trim() || null,
          city: editForm.city.trim() || null,
          state: editForm.state.trim() || null,
        })
        .eq('id', editTarget.id)

      if (updateError) {
        setError(mapInsertError(updateError.message))
        return
      }

      setNotice(`${name} updated.`)
      setEditTarget(null)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return
    clearMessages()
    setArchiving(true)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('properties')
        .update({ status: 'archived' })
        .eq('id', archiveTarget.id)

      if (updateError) {
        setError('Could not archive. Please try again.')
        return
      }

      setNotice(`${archiveTarget.name} archived.`)
      setArchiveTarget(null)
      router.refresh()
    } catch {
      setError('Could not archive. Please try again.')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Properties</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Physical locations managed under your organization. Units belong
          to a property.
        </p>
      </header>

      {!operational ? (
        <div className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <strong className="font-medium">Subscription not yet active.</strong>{' '}
          You can see existing properties but cannot add new ones until your
          organization is active.
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <FilterChip label="Active" value="active" current={filter} onSelect={setFilter} />
        <FilterChip label="All" value="all" current={filter} onSelect={setFilter} />
      </div>

      <section className="mb-8">
        {visibleProperties.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No properties yet. Add your first one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleProperties.map((p) => {
              const inactive = p.status !== 'active'
              const locationParts = [p.city, p.state].filter(Boolean).join(', ')
              return (
                <li
                  key={p.id}
                  className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 ${
                    inactive ? 'bg-muted/10 opacity-70' : 'bg-muted/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    {locationParts ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {locationParts}
                        {p.country && p.country !== 'NG' ? `, ${p.country}` : ''}
                      </p>
                    ) : null}
                    {p.address ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {p.address}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground mt-1 text-xs">
                      {p.unit_count} unit{p.unit_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        inactive
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {p.status}
                    </span>
                    {!inactive && operational ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setArchiveTarget(p)}
                          className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4"
                        >
                          Archive
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
          Add a property
        </h2>

        <form onSubmit={handleAdd} className="flex flex-col gap-4 rounded-lg border p-5">
          <div className="grid gap-2">
            <Label htmlFor="propName">Name</Label>
            <Input
              id="propName"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              placeholder="e.g. Green Valley Estate"
              disabled={!operational || adding}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="propAddress">
              Street address{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="propAddress"
              value={addForm.address}
              onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
              placeholder="e.g. 12 Adeniyi Jones Avenue"
              disabled={!operational || adding}
              className="h-11"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="propCity">
                City{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="propCity"
                value={addForm.city}
                onChange={(e) => setAddForm({ ...addForm, city: e.target.value })}
                placeholder="e.g. Ikeja"
                disabled={!operational || adding}
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="propState">
                State{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <select
                id="propState"
                value={addForm.state}
                onChange={(e) => setAddForm({ ...addForm, state: e.target.value })}
                disabled={!operational || adding}
                className="border-input bg-background h-11 rounded-md border px-3 text-sm"
              >
                <option value="">Select state</option>
                {NIGERIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="bg-muted rounded-md px-3 py-2 text-sm">{notice}</p>
          ) : null}

          <div>
            <Button type="submit" disabled={!operational || adding} className="h-11">
              {adding ? 'Adding…' : 'Add property'}
            </Button>
          </div>
        </form>
      </section>

      {/* Edit dialog */}
      <AlertDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditTarget(null)
        }}
      >
        <AlertDialogContent>
          <form onSubmit={handleEdit}>
            <AlertDialogHeader>
              <AlertDialogTitle>Edit {editTarget?.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Update the property details.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="editName">Name</Label>
                <Input
                  id="editName"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  disabled={saving}
                  autoFocus
                  className="h-11"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editAddress">Street address</Label>
                <Input
                  id="editAddress"
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  disabled={saving}
                  className="h-11"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="editCity">City</Label>
                  <Input
                    id="editCity"
                    value={editForm.city}
                    onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                    disabled={saving}
                    className="h-11"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editState">State</Label>
                  <select
                    id="editState"
                    value={editForm.state}
                    onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                    disabled={saving}
                    className="border-input bg-background h-11 rounded-md border px-3 text-sm"
                  >
                    <option value="">Select state</option>
                    {NIGERIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive dialog */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !archiving) setArchiveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived properties are hidden from the active list but their
              units and history remain. You can restore them later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleArchive()
              }}
              disabled={archiving}
            >
              {archiving ? 'Archiving…' : 'Archive'}
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

function mapInsertError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('row-level security') || lower.includes('permission')) {
    return 'Your organization is not active yet. Complete setup or choose a plan first.'
  }
  if (lower.includes('properties_unique_name_per_org') || lower.includes('duplicate')) {
    return 'A property with this name already exists. Choose a different name.'
  }
  return 'Could not save the property. Please try again.'
}
