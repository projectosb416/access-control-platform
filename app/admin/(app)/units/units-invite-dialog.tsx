'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import type { GeneratedInvite, UnitRow } from './types'

/**
 * Share dialog for a freshly-generated unit invite. The link is displayed
 * once, with copy + WhatsApp + Email actions. The plaintext code is only
 * ever held in the parent's memory — not stored anywhere durable.
 */
export function InviteDialog({
  invite,
  onClose,
}: {
  invite: GeneratedInvite | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  if (!invite) return null

  const message = `Hi — you've been invited to join ${invite.propertyName} on the Access Control Platform.

Open this link to set up your account and access the estate:

${invite.link}

The link expires in 24 hours.`

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(message)}`
  const emailHref = `mailto:?subject=${encodeURIComponent(
    `Access invite for ${invite.propertyName}`,
  )}&body=${encodeURIComponent(message)}`

  async function copyLink() {
    if (!invite) return
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
          Send this link to the person who will become the Primary Resident
          of the unit. It expires in 24 hours and can only be used once.
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
            onClick={copyLink}
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

/**
 * Confirm dialog for cancelling a live invite. Controlled by the parent —
 * the parent owns the target and cancelling state, this just renders.
 */
export function CancelInviteDialog({
  target,
  cancelling,
  onConfirm,
  onClose,
}: {
  target: UnitRow | null
  cancelling: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !cancelling) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Cancel invite for {target?.label}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The invite link stops working immediately. The unit returns to
            vacant. You can generate a new invite any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>Keep invite</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Cancel invite'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
