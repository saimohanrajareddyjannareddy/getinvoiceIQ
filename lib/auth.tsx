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

// Only the signed-in app needs a session: everything under /dashboard.
// Every other path is public — the marketing page, auth flows, legal
// pages (Google OAuth verification and Stripe link to /privacy and
// /terms for signed-out visitors), /reset-password (which handles a
// missing session itself and must exchange its recovery code before
// any redirect), and unknown paths, which should show the 404 page
// rather than bounce to /login. Data is protected by RLS either way;
// this guard only decides where the browser goes.
const PRIVATE_PREFIXES = ['/dashboard']

function isPublicRoute(pathname: string): boolean {
  return !PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
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
