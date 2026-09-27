'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * /resident/join — manual invite code entry.
 *
 * Covers the "link was lost" case: the recipient pastes their code and is
 * forwarded to /resident/join/[code], which handles the redemption flow.
 *
 * No session required. The form just validates the shape (8 chars, our
 * alphabet) and redirects. Real validation happens on the destination page.
 */

const CODE_LENGTH = 8
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export default function ManualJoinPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const normalized = code.trim().toUpperCase()
    if (normalized.length !== CODE_LENGTH) {
      setError(`Invite codes are ${CODE_LENGTH} characters.`)
      return
    }
    for (const ch of normalized) {
      if (!ALPHABET.includes(ch)) {
        setError('That code contains invalid characters. Check and try again.')
        return
      }
    }

    router.push(`/resident/join/${normalized}`)
  }

  return (
    <main className="flex flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Enter your invite code
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Paste the code from your invitation.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="code">Invite code</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXXXXX"
            maxLength={CODE_LENGTH}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 text-center font-mono text-lg tracking-widest"
            autoFocus
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

        <Button type="submit" className="h-11 w-full">
          Continue
        </Button>
      </form>

      <p className="text-muted-foreground mt-8 text-center text-xs">
        <Link href="/resident/login" className="underline underline-offset-4">
          Already have an account? Log in
        </Link>
      </p>
    </main>
  )
}
