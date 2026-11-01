'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/auth-errors'
import GoogleAuthButton from '@/components/GoogleAuthButton'

/*
 * InvoiceIQ — Login page.
 * Left = sign-in form (email/password or Google), right = a product proof
 * panel on desktop. A compact proof strip carries the same facts on mobile.
 */
export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(friendlyAuthError(error.message))
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 font-sans text-ink md:grid-cols-2">
      {/* LEFT: form */}
      <div className="relative flex flex-col bg-cream px-6 py-10 md:px-14">
        <div className="flex items-baseline gap-px font-display text-[27px] font-extrabold tracking-[-0.5px] text-ink">
          <span>getinvoiceIQ</span>
          <span className="text-[32px] leading-[0] text-terracotta">.</span>
        </div>

        <div className="mx-auto my-auto w-full max-w-[380px] self-center py-10">
          <h1 className="mb-2 font-display text-[50px] font-extrabold leading-none tracking-[-1px] text-ink">
            Welcome back.
          </h1>
          <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
            Pick up the week where the numbers left it.
          </p>

          <GoogleAuthButton onError={setError} />

          <div className="my-[22px] flex items-center gap-[14px]">
            <div className="h-px flex-1 bg-ink/[0.14]" />
            <span className="text-[13px] text-[#9A9384]">or use email</span>
            <div className="h-px flex-1 bg-ink/[0.14]" />
          </div>

          {error && (
            <p role="alert" className="mb-5 rounded-[9px] border border-[#C0392B]/25 bg-[#C0392B]/[0.07] px-4 py-3 text-[13.5px] leading-[1.5] text-[#8E2F24]">
              {error}
            </p>
          )}

          <form onSubmit={handleLogin}>
            <label className="mb-[7px] block text-[13px] font-semibold text-ink-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@restaurant.com"
              autoComplete="email"
              required
              className="mb-[18px] w-full rounded-[9px] border border-ink/20 bg-cream-surface px-[15px] py-[13px] text-[15px] text-ink outline-none focus:border-terracotta"
            />

            <div className="mb-[7px] flex items-center justify-between gap-4">
              <label htmlFor="login-password" className="text-[13px] font-semibold text-ink-2">Password</label>
              <Link href="/forgot-password" className="text-[13px] font-semibold text-pop hover:text-pop-hover">
                Forgot password?
              </Link>
            </div>
            <div className="relative mb-6">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                autoComplete="current-password"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-[9px] bg-terracotta py-[14px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-[30px] text-center text-[14px] text-ink-3">
            New to InvoiceIQ?{' '}
            <Link href="/signup" className="font-semibold text-pop hover:text-pop-hover">
              Create an account
            </Link>
          </p>

          <div className="mt-8 grid grid-cols-3 gap-2 text-center md:hidden">
            <div className="rounded-[10px] border border-ink/[0.08] bg-cream-surface px-2 py-3">
              <div className="font-display text-[16px] font-bold text-ink">500+</div>
              <div className="mt-1 text-[10.5px] leading-tight text-ink-muted">pilot invoices</div>
            </div>
            <div className="rounded-[10px] border border-ink/[0.08] bg-cream-surface px-2 py-3">
              <div className="font-display text-[16px] font-bold text-ink">99%+</div>
              <div className="mt-1 text-[10.5px] leading-tight text-ink-muted">checked accuracy</div>
            </div>
            <div className="rounded-[10px] border border-ink/[0.08] bg-cream-surface px-2 py-3">
              <div className="font-display text-[16px] font-bold text-ink">Review</div>
              <div className="mt-1 text-[10.5px] leading-tight text-ink-muted">before totals count</div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: visual (design-only, hidden on mobile) */}
      <div className="relative hidden flex-col justify-center bg-coal px-14 py-10 text-[#EDEFE8] md:flex">
        <div className="mx-auto w-full max-w-[440px]">
          {/* mini price tracker */}
          <div className="relative rounded-[16px] border border-[rgba(255,253,249,.12)] bg-[rgba(255,253,249,.05)] p-[22px]">
            <div className="mb-0.5 font-serif text-[21px] text-cream">Price tracker</div>
            <div className="mb-[18px] font-mono text-[12px] text-forest-light">Unit price · trailing 6 weeks</div>
            <svg viewBox="0 0 400 180" className="block h-auto w-full" preserveAspectRatio="none">
              <line x1="0" y1="45" x2="400" y2="45" stroke="rgba(255,253,249,.08)" strokeWidth="1" />
              <line x1="0" y1="90" x2="400" y2="90" stroke="rgba(255,253,249,.08)" strokeWidth="1" />
              <line x1="0" y1="135" x2="400" y2="135" stroke="rgba(255,253,249,.08)" strokeWidth="1" />
              <polyline points="8,128 74,124 140,118 206,104 272,88 338,54 394,32" fill="none" stroke="#EC4899" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="394" cy="32" r="5" fill="#EC4899" />
              <polyline points="8,92 74,96 140,90 206,94 272,88 338,92 394,89" fill="none" stroke="#8FA79A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="8,80 74,88 140,100 206,110 272,126 338,138 394,150" fill="none" stroke="#C7D6CD" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="394" cy="150" r="5" fill="#C7D6CD" />
            </svg>
            <div className="mt-[14px] flex gap-[16px] font-mono text-[11px]">
              <span className="inline-flex items-center gap-[6px] text-[#F9A8D4]"><span className="h-[3px] w-[9px] rounded-[2px] bg-[#EC4899]" />Yellow onions</span>
              <span className="inline-flex items-center gap-[6px] text-forest-light"><span className="h-[3px] w-[9px] rounded-[2px] bg-[#8FA79A]" />Roma tomatoes</span>
              <span className="inline-flex items-center gap-[6px] text-[#C7D6CD]"><span className="h-[3px] w-[9px] rounded-[2px] bg-[#C7D6CD]" />Chicken thighs</span>
            </div>
            {/* callout */}
            <div className="absolute right-[24px] top-[70px] max-w-[190px] rounded-[10px] bg-ink px-[13px] py-[10px] shadow-[0_14px_30px_-12px_rgba(0,0,0,.55)]">
              <div className="font-mono text-[13px] font-semibold text-[#F9A8D4]">Yellow onions ↑ 22% this week</div>
              <div className="mt-[3px] text-[11px] text-[#C7C0B4]">3 vendors compared</div>
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-[18px] font-serif text-[27px] font-normal leading-[1.3] text-cream">
              The work is already moving while you sign in.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-4">
                <div className="font-display text-[24px] font-extrabold text-cream">500+</div>
                <div className="mt-1 text-[12.5px] text-cream/60">pilot invoices processed</div>
              </div>
              <div className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-4">
                <div className="font-display text-[24px] font-extrabold text-cream">99%+</div>
                <div className="mt-1 text-[12.5px] text-cream/60">accuracy in hand-checked samples</div>
              </div>
            </div>
            <p className="mt-4 text-[13.5px] leading-[1.55] text-cream/55">
              Receipts read, totals recomputed, and price changes waiting for your morning pass.
            </p>
          </div>
        </div>

        <div className="absolute bottom-8 left-14 font-serif text-[20px] text-[rgba(247,243,237,.55)]">
          getinvoiceIQ<span className="text-terracotta-hover">.</span>
        </div>
      </div>
    </div>
  )
}
