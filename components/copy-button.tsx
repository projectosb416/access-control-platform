'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Copy-to-clipboard icon button.
 *
 * Used wherever a code (Guard ID, Shift code, PIN) needs to be shared
 * with someone outside the admin — the fastest reliable way to move a
 * code from a screen to WhatsApp is one tap. Manual transcription is how
 * typos happen.
 *
 * Falls back to a no-op if clipboard API is unavailable (older browsers,
 * non-secure contexts). The code remains visible next to the button, so
 * manual selection always works.
 *
 * Confirmation is inline (icon swaps to a checkmark for 1.5s) rather than
 * a toast — no global Toaster required, no dependency on a provider.
 */

export function CopyButton({
  value,
  label = 'Copy',
  className = '',
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable. Silent — code is visible for manual copy.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={`inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  )
}
