'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/auth-errors'

/**
 * getinvoiceIQ — Reset password.
 * Landing page for the recovery email. Supabase recovery links arrive with
 * either session tokens in the URL hash (implicit flow) or a one-time code
 * in the query string; this page accepts both, then lets the user set the
 * new password with updateUser while the recovery session is active.
 */
export default function ResetPasswordPage() {
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true

    async function prepare() {
      const url = new URL(window.location.href)
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
      const access_token = hash.get('access_token')
      const refresh_token = hash.get('refresh_token')
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token })
        if (!error && active) {
          setReady(true)
          setChecking(false)
          return
        }
      }
      const code = url.searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error && active) {
          setReady(true)
          setChecking(false)
          return
        }
      }
      const { data } = await supabase.auth.getSession()
      if (active) {
        setReady(Boolean(data.session))
        setChecking(false)
      }
    }

    prepare()
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
        setChecking(false)
      }
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match. Type them again.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(friendlyAuthError(error.message))
      setLoading(false)
      return
    }
    setDone(true)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream px-6 py-10 font-sans text-ink">
      <Link href="/" className="flex items-baseline gap-px self-start font-display text-[27px] font-extrabold tracking-[-0.5px] text-ink">
        <span>getinvoiceIQ</span>
        <span className="text-[32px] leading-[0] text-terracotta">.</span>
      </Link>

      <div className="mx-auto my-auto w-full max-w-[400px] py-10">
        {done ? (
          <>
            <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
              Password updated.
            </h1>
            <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
              Your new password is in place and you are signed in. Head back to your numbers.
            </p>
            <Link
              href="/dashboard"
              className="block w-full rounded-[9px] bg-terracotta py-[14px] text-center text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover"
            >
              Go to your dashboard
            </Link>
          </>
        ) : checking ? (
          <p className="text-center text-[15px] text-ink-3">Checking your reset link…</p>
        ) : !ready ? (
          <>
            <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
              That link has lapsed.
            </h1>
            <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
              Reset links expire, and they only work once. Request a fresh one and use it right away.
            </p>
            <Link
              href="/forgot-password"
              className="block w-full rounded-[9px] bg-terracotta py-[14px] text-center text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover"
            >
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
              Set a new password.
            </h1>
            <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
              Pick something fresh — at least 8 characters. You will stay signed in when it saves.
            </p>

            {error && (
              <p role="alert" className="mb-5 rounded-[9px] border border-[#C0392B]/25 bg-[#C0392B]/[0.07] px-4 py-3 text-[13.5px] leading-[1.5] text-[#8E2F24]">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit}>
              <label htmlFor="reset-password" className="mb-[7px] block text-[13px] font-semibold text-ink-2">New password</label>
              <div className="relative mb-[18px]">
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  className="w-full rounded-[9px] border border-ink/20 bg-cream-surface px-[15px] py-[13px] pr-12 text-[15px] text-ink outline-none focus:border-terracotta"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-muted hover:text-ink"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <label htmlFor="reset-confirm" className="mb-[7px] block text-[13px] font-semibold text-ink-2">Type it again</label>
              <input
                id="reset-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Same password, once more"
                autoComplete="new-password"
                required
                className="mb-6 w-full rounded-[9px] border border-ink/20 bg-cream-surface px-[15px] py-[13px] text-[15px] text-ink outline-none focus:border-terracotta"
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-[9px] bg-terracotta py-[14px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
