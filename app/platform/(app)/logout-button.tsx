'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export function LogoutButton() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function handleLogout() {
    setSubmitting(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {
      // Best effort. Always navigate.
    }
    router.replace('/platform/login')
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleLogout}
      disabled={submitting}
    >
      {submitting ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
