'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

/**
 * getinvoiceIQ — OAuth return point.
 * Google sign-in lands here after Supabase. Depending on the project's flow
 * the session arrives as a one-time code to exchange, as hash tokens the
 * Supabase client absorbs on load, or as an already-stored session. We
 * LISTEN for the session (auth state change) instead of polling on a
 * short fuse: the old version gave up to /login after ~4s, and the
 * session often landed a beat later — the AuthProvider then bounced
 * the user from the login page to the dashboard, which looked like
 * an error. Now the move happens the moment the session exists, and
 * /login is only the fallback if nothing arrives within 8 seconds.
 */
export default function AuthCallbackPage() {
  const router = useRouter()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let redirected = false

    const go = (path: string) => {
      if (!redirected) {
        redirected = true
        router.replace(path)
      }
    }

    // Move the moment a session exists, however it arrives.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go('/dashboard')
    })

    ;(async () => {
      const code = new URL(window.location.href).searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
          go('/dashboard')
          return
        }
      }
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        go('/dashboard')
        return
      }
      // Hash-token absorption fires the listener above; only if no
      // session materializes at all do we fall back to the sign-in page.
      setTimeout(() => go('/login'), 8000)
    })()

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 font-sans text-ink">
      <div className="flex items-baseline gap-px font-display text-[30px] font-extrabold tracking-[-0.5px]">
        <span>getinvoiceIQ</span>
        <span className="text-[34px] leading-[0] text-terracotta">.</span>
      </div>
      <p className="mt-4 text-[15px] text-ink-3">Signing you in…</p>
    </div>
  )
}
