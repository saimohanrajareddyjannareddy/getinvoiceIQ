'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

type Ctx = {
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<Ctx>({
  session: null,
  loading: true,
  signOut: async () => {},
})

// Public routes — viewable without authentication (marketing landing + auth
// flows + auth callbacks). Everything else requires a session.
// (Static assets like /_next/*, /favicon.ico are served by Next directly and
// never reach this client provider, so they don't need to be listed here.)
// /privacy and /terms must stay public: Google OAuth verification and
// Stripe both link to them for signed-out visitors. /reset-password
// handles a missing session itself, and redirecting it before it can
// exchange the recovery code breaks the reset link.
const PUBLIC_ROUTES = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/privacy', '/terms']
const PUBLIC_PREFIXES = ['/auth', '/api/webhooks']

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (loading) return
    if (!session && !isPublicRoute(pathname)) router.replace('/login')
    if (session && pathname === '/login') router.replace('/dashboard')
  }, [session, loading, pathname, router])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <AuthContext.Provider value={{ session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
