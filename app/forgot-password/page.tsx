'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/auth-errors'

/**
 * InvoiceIQ — Forgot password.
 * Sends Supabase's recovery email; the link lands on /reset-password.
 * The sent state uses the same words whether or not the email has an
 * account, so the page never reveals which emails are registered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) {
      setError(friendlyAuthError(error.message))
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream px-6 py-10 font-sans text-ink">
      <Link href="/" className="flex items-baseline gap-px self-start font-display text-[27px] font-extrabold tracking-[-0.5px] text-ink">
        <span>getinvoiceIQ</span>
        <span className="text-[32px] leading-[0] text-terracotta">.</span>
      </Link>

      <div className="mx-auto my-auto w-full max-w-[400px] py-10">
        {sent ? (
          <>
            <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
              Check your email.
            </h1>
            <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
              If an account uses <span className="font-semibold text-ink-2">{email}</span>, a password reset link is
              on its way. The link expires after a while — if it lapses, come back and request a fresh one.
            </p>
            <Link
              href="/login"
              className="block w-full rounded-[9px] bg-terracotta py-[14px] text-center text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
              Forgot it? Reset it.
            </h1>
            <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
              Enter the email on your account and we will send a link to set a new password.
            </p>

            {error && (
              <p role="alert" className="mb-5 rounded-[9px] border border-[#C0392B]/25 bg-[#C0392B]/[0.07] px-4 py-3 text-[13.5px] leading-[1.5] text-[#8E2F24]">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit}>
              <label htmlFor="forgot-email" className="mb-[7px] block text-[13px] font-semibold text-ink-2">Email</label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.com"
                autoComplete="email"
                required
                className="mb-6 w-full rounded-[9px] border border-ink/20 bg-cream-surface px-[15px] py-[13px] text-[15px] text-ink outline-none focus:border-terracotta"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-[9px] bg-terracotta py-[14px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover disabled:opacity-50"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="mt-[26px] text-center text-[14px] text-ink-3">
              Remembered it?{' '}
              <Link href="/login" className="font-semibold text-pop hover:text-pop-hover">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
