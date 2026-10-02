'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import type { HouseholdMember } from './types'

/**
 * Household section for the resident dashboard. Lists current household
 * members (invited / active / ended) and provides three actions:
 *
 *   Generate invite — 8-char code, 24h validity, single-use
 *   Cancel invite   — retract a pending invite before redemption
 *   End member      — remove an active member; cascade trigger (0031)
 *                     revokes their active unit authorizations
 *
 * All three actions go through SECURITY DEFINER RPCs from migration
 * 0057. The row-scoped INSERT/UPDATE policies on household_members
 * were dropped in the same migration — there is no client-reachable
 * write path other than these functions.
 *
 * Constraints baked in:
 *   - Only one live invite per unit at a time (partial unique index
 *     household_members_one_pending_per_unit). The Invite button is
 *     disabled while a pending invite exists.
 *   - end_household_member accepts only active rows; invited rows go
 *     through cancel_household_invite instead.
 *
 * Time formatting is local to this file, mirroring recent-visits-section.
 * A shared util is a future refactor candidate, not this slice.
 */

type GeneratedInvite = {
  householdMemberId: string
  code: string
  link: string
  expiresAt: string
}

const INVITE_DURATION_MINUTES = 24 * 60

export function HouseholdSection({
  unitId,
  estateName,
  unitLabel,
  initialMembers,
  nowIso,
}: {
  unitId: string
  estateName: string
  unitLabel: string
  initialMembers: HouseholdMember[]
  nowIso: string
}) {
  const router = useRouter()

  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedInvite | null>(null)
  const [cancelTarget, setCancelTarget] = useState<HouseholdMember | null>(null)
  const [endTarget, setEndTarget] = useState<HouseholdMember | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invited = initialMembers.filter((m) => m.status === 'invited')
  const active  = initialMembers.filter((m) => m.status === 'active')
  const ended   = initialMembers.filter((m) => m.status === 'ended')

  async function handleGenerate() {
    setError(null)
    setGenerating(true)
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc(
        'generate_household_invite',
        {
          p_unit_id: unitId,
          p_duration_minutes: INVITE_DURATION_MINUTES,
        },
      )

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      const row = Array.isArray(data) ? data[0] : data
      const id = (row?.household_member_id as string) ?? ''
      const code = (row?.code as string) ?? ''
      const expiresAt = (row?.expires_at as string) ?? ''

      if (!id || !code || !expiresAt) {
        setError('Invite was generated but response was malformed.')
        return
      }

      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const link = `${origin}/resident/join/${code}`

      setGenerated({ householdMemberId: id, code, link, expiresAt })
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return
    setError(null)
    setCancelling(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        'cancel_household_invite',
        {
          p_unit_id: unitId,
          p_reason: 'cancelled by primary resident',
        },
      )

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      setCancelTarget(null)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  async function handleEnd() {
    if (!endTarget) return
    setError(null)
    setEnding(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('end_household_member', {
        p_household_member_id: endTarget.household_member_id,
        p_reason: 'removed by primary resident',
      })

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      setEndTarget(null)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setEnding(false)
    }
  }

  return (
    <section className="bg-muted/40 mt-6 rounded-lg border p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Household</h2>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating || invited.length > 0}
        >
          {generating ? 'Generating…' : 'Invite member'}
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mb-3 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {invited.length === 0 && active.length === 0 && ended.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No household members yet. Invite someone who lives with you.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {active.length > 0 ? (
            <MemberList
              title="Active"
              members={active}
              nowIso={nowIso}
              onEnd={(m) => setEndTarget(m)}
            />
          ) : null}
          {invited.length > 0 ? (
            <MemberList
              title="Invite pending"
              members={invited}
              nowIso={nowIso}
              onCancel={(m) => setCancelTarget(m)}
            />
          ) : null}
          {ended.length > 0 ? (
            <MemberList title="Ended" members={ended} nowIso={nowIso} />
          ) : null}
        </div>
      )}

      {generated ? (
        <ShareDialog
          invite={generated}
          estateName={estateName}
          unitLabel={unitLabel}
          onClose={() => setGenerated(null)}
        />
      ) : null}

      {cancelTarget ? (
        <ConfirmDialog
          key={cancelTarget.household_member_id}
          title="Cancel this invite?"
          body="The invite link stops working immediately. You can generate a new one anytime."
          confirmLabel={cancelling ? 'Cancelling…' : 'Cancel invite'}
          confirmDisabled={cancelling}
          onConfirm={() => void handleCancel()}
          onClose={() => setCancelTarget(null)}
        />
      ) : null}

      {endTarget ? (
        <ConfirmDialog
          key={endTarget.household_member_id}
          title={`Remove ${endTarget.full_name ?? 'this member'}?`}
          body="Their household access stops immediately, and any guest PINs they created for this unit are revoked."
          confirmLabel={ending ? 'Removing…' : 'Remove'}
          confirmDisabled={ending}
          onConfirm={() => void handleEnd()}
          onClose={() => setEndTarget(null)}
        />
      ) : null}
    </section>
  )
}

function MemberList({
  title,
  members,
  nowIso,
  onEnd,
  onCancel,
}: {
  title: string
  members: HouseholdMember[]
  nowIso: string
  onEnd?: (m: HouseholdMember) => void
  onCancel?: (m: HouseholdMember) => void
}) {
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <MemberRow
            key={m.household_member_id}
            member={m}
            nowIso={nowIso}
            onEnd={onEnd}
            onCancel={onCancel}
          />
        ))}
      </ul>
    </div>
  )
}

function MemberRow({
  member,
  nowIso,
  onEnd,
  onCancel,
}: {
  member: HouseholdMember
  nowIso: string
  onEnd?: (m: HouseholdMember) => void
  onCancel?: (m: HouseholdMember) => void
}) {
  const displayName = member.full_name ?? 'Invite pending'
  const subtitle = describeMember(member, nowIso)

  return (
    <li className="bg-background flex items-start justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{displayName}</p>
        {subtitle ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{subtitle}</p>
        ) : null}
      </div>
      {onEnd ? (
        <button
          type="button"
          onClick={() => onEnd(member)}
          className="text-muted-foreground hover:text-destructive shrink-0 text-xs underline underline-offset-4"
        >
          Remove
        </button>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          onClick={() => onCancel(member)}
          className="text-muted-foreground hover:text-destructive shrink-0 text-xs underline underline-offset-4"
        >
          Cancel
        </button>
      ) : null}
    </li>
  )
}

function describeMember(m: HouseholdMember, nowIso: string): string | null {
  if (m.status === 'active') {
    if (!m.joined_at) return 'Active'
    return `Joined ${formatAbsolute(new Date(m.joined_at), new Date(nowIso))}`
  }
  if (m.status === 'invited') {
    if (!m.invite_expires_at) return 'Invite pending'
    const d = new Date(m.invite_expires_at)
    const now = new Date(nowIso)
    if (d.getTime() <= now.getTime()) return 'Invite expired'
    return `Invite expires ${formatAbsolute(d, now)}`
  }
  if (m.status === 'ended') {
    const reason = m.end_reason ?? 'ended'
    if (!m.ended_at) return `Ended · ${reason}`
    return `Ended ${formatAbsolute(new Date(m.ended_at), new Date(nowIso))} · ${reason}`
  }
  return null
}

function ShareDialog({
  invite,
  estateName,
  unitLabel,
  onClose,
}: {
  invite: GeneratedInvite
  estateName: string
  unitLabel: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const message = `Hi — you've been invited to join ${estateName}, Unit ${unitLabel} as a household member.

Open this link to set up your account and access the estate:

${invite.link}

The link expires in 24 hours and can only be used once.`

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(message)}`
  const emailHref = `mailto:?subject=${encodeURIComponent(
    `Household invite for ${estateName}`,
  )}&body=${encodeURIComponent(message)}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable. Link is visible for manual selection.
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="bg-background relative w-full max-w-md rounded-lg border p-5 shadow-lg">
        <h3 className="text-lg font-semibold tracking-tight">
          Invite ready to share
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Send this link to the person joining your unit. It expires in 24
          hours and can only be used once.
        </p>

        <div className="bg-muted mt-4 rounded-md border px-3 py-2">
          <p className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wide">
            Invite link
          </p>
          <p className="break-all font-mono text-xs">{invite.link}</p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="border-input hover:bg-muted rounded-md border px-3 py-2 text-sm font-medium transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="border-input hover:bg-muted rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors"
          >
            WhatsApp
          </a>
          <a
            href={emailHref}
            className="border-input hover:bg-muted rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors"
          >
            Email
          </a>
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  onClose,
}: {
  title: string
  body: string
  confirmLabel: string
  confirmDisabled: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="bg-background relative w-full max-w-md rounded-lg border p-5 shadow-lg">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-muted-foreground mt-2 text-sm">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={confirmDisabled}
          >
            Keep
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function formatAbsolute(d: Date, now: Date): string {
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()

  if (sameDay) return `today at ${formatTimeUTC(d)}`

  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const isYesterday =
    d.getUTCFullYear() === yesterday.getUTCFullYear() &&
    d.getUTCMonth() === yesterday.getUTCMonth() &&
    d.getUTCDate() === yesterday.getUTCDate()

  if (isYesterday) return `yesterday at ${formatTimeUTC(d)}`

  return `${formatDateUTC(d)} at ${formatTimeUTC(d)}`
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDateUTC(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function formatTimeUTC(d: Date): string {
  const h24 = d.getUTCHours()
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = ((h24 + 11) % 12) + 1
  return `${h12}:${m} ${period}`
}

function friendlyError(code: string): string {
  if (code.includes('NOT_AUTHENTICATED')) return 'Your session expired. Please log in again.'
  if (code.includes('NOT_AUTHORIZED')) return "You don't have permission to do that."
  if (code.includes('SUBSCRIPTION_INACTIVE')) return "This estate's subscription is inactive."
  if (code.includes('UNIT_NOT_FOUND')) return 'Unit not found.'
  if (code.includes('UNIT_NOT_ACTIVE')) return 'This unit is no longer active.'
  if (code.includes('INVALID_DURATION')) return 'Invalid invite duration.'
  if (code.includes('CODE_GENERATION_FAILED')) return 'Could not generate the invite. Please try again.'
  if (code.includes('INVITE_NOT_FOUND')) return 'No pending invite to cancel.'
  if (code.includes('HOUSEHOLD_MEMBER_NOT_FOUND')) return 'Member no longer exists.'
  if (code.includes('HOUSEHOLD_MEMBER_NOT_ACTIVE')) return 'That member is not active.'
  return 'Something went wrong. Please try again.'
}
