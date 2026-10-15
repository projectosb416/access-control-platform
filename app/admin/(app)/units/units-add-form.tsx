'use client'

import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { parseCsv } from '@/lib/admin/csv'

/**
 * Add-units section — single-add, bulk-add with preview, and the preview
 * overlay. Self-contained: owns its own form state, error, and notice.
 * Errors display inside the section, near the form that produced them.
 *
 * After a successful insert, calls router.refresh() to re-fetch the list
 * from the Server Component — no client-side list mutation.
 */

const BULK_MAX = 500

type Mode = 'single' | 'bulk' | 'csv'

interface PreviewRow {
  label: string
  notes?: string
  conflict: boolean
}

export function AddUnitsSection({
  propertyId,
  existingLabels,
  operational,
}: {
  propertyId: string
  existingLabels: Set<string>
  operational: boolean
}) {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('single')

  // Single-add
  const [singleLabel, setSingleLabel] = useState('')
  const [singleNotes, setSingleNotes] = useState('')

  // Bulk-add
  const [bulkPrefix, setBulkPrefix] = useState('')
  const [bulkStart, setBulkStart] = useState('1')
  const [bulkEnd, setBulkEnd] = useState('10')
  const [bulkNotes, setBulkNotes] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  // CSV-add
  const [csvFileName, setCsvFileName] = useState('')
  const [csvRowCount, setCsvRowCount] = useState(0)
  const [csvPreview, setCsvPreview] = useState<PreviewRow[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

  const previewRows = mode === 'csv' ? csvPreview : bulkPreview
  const bulkCount = previewRows.length
  const bulkConflicts = previewRows.filter((r) => r.conflict).length
  const bulkClean = bulkCount - bulkConflicts

  function clearMessages() {
    setError(null)
    setNotice(null)
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
    const rows = previewRows
      .filter((r) => !r.conflict)
      .map((r) => ({
        property_id: propertyId,
        label: r.label,
        notes: (r.notes ?? bulkNotes).trim() || null,
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
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
      setPreviewOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  function handleCsvFile(e: ChangeEvent<HTMLInputElement>) {
    clearMessages()
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFileName(file.name)
    setCsvRowCount(0)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        const { rows } = parseCsv(text)
        if (rows.length === 0) {
          setError('CSV has no data rows.')
          return
        }
        if (rows.length > BULK_MAX) {
          setError(`CSV has ${rows.length} rows; maximum is ${BULK_MAX}.`)
          return
        }
        const labelKey = (v: string) => v.trim().toLowerCase()
        const preview: PreviewRow[] = []
        for (const r of rows) {
          const label = (r.label ?? '').trim()
          if (!label) continue
          preview.push({
            label,
            notes: (r.notes ?? '').trim() || undefined,
            conflict: existingLabels.has(labelKey(label)),
          })
        }
        if (preview.length === 0) {
          setError('No valid rows found. The label column is required.')
          return
        }
        setCsvRowCount(preview.length)
        setCsvPreview(preview)
        setPreviewOpen(true)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'CSV_EMPTY') setError('The file is empty.')
        else if (msg === 'CSV_UNBALANCED_QUOTE')
          setError('A quoted field was not closed. Check the file for stray quotes.')
        else setError('Could not read the CSV. Check the format and try again.')
      }
    }
    reader.onerror = () => {
      setError('Could not read the file.')
    }
    reader.readAsText(file)
  }

  return (
    <section>
      <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
        Add units
      </h2>

      <div className="rounded-lg border p-5">
        <div className="bg-muted mb-4 flex gap-1 rounded-lg p-1">
          <ModeTab label="Single" value="single" current={mode} onSelect={setMode} />
          <ModeTab label="Bulk" value="bulk" current={mode} onSelect={setMode} />
          <ModeTab label="CSV" value="csv" current={mode} onSelect={setMode} />
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
              <Button type="submit" disabled={!operational || submitting} className="h-11">
                {submitting ? 'Adding…' : 'Add unit'}
              </Button>
            </div>
          </form>
        ) : mode === 'bulk' ? (
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
                    bulkConflicts > 0 ? `, ${bulkConflicts} already exist` : ''
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
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="csvFile">CSV file</Label>
              <input
                id="csvFile"
                type="file"
                accept=".csv,text/csv"
                disabled={!operational || submitting}
                onChange={handleCsvFile}
                className="border-input bg-background h-11 rounded-md border px-3 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium"
              />
              <p className="text-muted-foreground text-xs">
                Header row required. Columns: <code>label</code> (required),{' '}
                <code>notes</code> (optional). Max {BULK_MAX} rows per
                file. Existing labels are skipped.
              </p>
            </div>

            {csvFileName ? (
              <div className="text-muted-foreground text-xs">
                {csvRowCount} row{csvRowCount === 1 ? '' : 's'} loaded from {csvFileName}
              </div>
            ) : null}
          </div>
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
      </div>

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
                {previewRows.map((row, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                      row.conflict ? 'bg-muted/40 text-muted-foreground line-through' : ''
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
                {submitting ? 'Creating…' : `Create ${bulkClean} unit${bulkClean === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
