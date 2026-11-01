'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/auth-errors'
import GoogleAuthButton from '@/components/GoogleAuthButton'

/*
 * InvoiceIQ — Signup page.
 * One email form creates the account AND names the first restaurant: the
 * restaurant name rides in Supabase user metadata, and lib/restaurant.tsx
 * auto-creates the restaurant from it on first sign-in. Google creates the
 * account first; the dashboard's empty state then asks for the restaurant.
 */
export default function SignupPage() {
  const router = useRouter()
  const [restaurantName, setRestaurantName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // A plain strength readout: length first, then character variety. This is
  // guidance in the form, not a second set of signup rules.
  const passwordChecks = [
    password.length >= 8,
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  const passwordScore = passwordChecks.filter(Boolean).length
  const passwordLabel =
    password.length === 0 ? '' : passwordScore <= 1 ? 'Weak' : passwordScore <= 3 ? 'Getting there' : passwordScore === 4 ? 'Strong' : 'Excellent'

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          restaurant_name: restaurantName.trim(),
        },
      },
    })
    if (error) {
      setError(friendlyAuthError(error.message))
      setLoading(false)
      return
    }
    if (data.session) {
      // Email confirmation off: signed in immediately. The restaurant
      // provider auto-creates the restaurant from user metadata.
      router.push('/dashboard')
    } else {
      // Email confirmation on: no session until they click the email link.
      setConfirmSent(true)
      setLoading(false)
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
          {confirmSent ? (
            <>
              <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
                Check your email.
              </h1>
              <p className="mb-[34px] text-[16px] text-ink-3">
                We sent a confirmation link to <span className="font-semibold text-ink-2">{email}</span>.
                Click it, then sign in — your restaurant <span className="font-semibold text-ink-2">{restaurantName}</span> will
                be set up automatically.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-[9px] bg-terracotta py-[14px] text-center text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover"
              >
                Go to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="mb-2 font-display text-[42px] font-extrabold leading-none tracking-[-1px] text-ink">
                Start your trial.
              </h1>
              <p className="mb-[30px] text-[16px] leading-[1.55] text-ink-3">
                Fourteen days free. Bring one real invoice and see what it says about your food cost.
              </p>

              <GoogleAuthButton onError={setError} />
              <p className="mt-3 text-center text-[12.5px] leading-[1.5] text-ink-muted">
                Google creates your account first; you will name the restaurant on the next screen.
              </p>

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

              <form onSubmit={handleSignup}>
                <label className="mb-[7px] block text-[13px] font-semibold text-ink-2">Restaurant name</label>
                <input
                  type="text"
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                  placeholder="Your restaurant's name"
                  autoComplete="organization"
                  required
                  className="mb-[18px] w-full rounded-[9px] border border-ink/20 bg-cream-surface px-[15px] py-[13px] text-[15px] text-ink outline-none focus:border-terracotta"
                />

                <label className="mb-[7px] block text-[13px] font-semibold text-ink-2">Your name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  required
                  className="mb-[18px] w-full rounded-[9px] border border-ink/20 bg-cream-surface px-[15px] py-[13px] text-[15px] text-ink outline-none focus:border-terracotta"
                />

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

                <label htmlFor="signup-password" className="mb-[7px] block text-[13px] font-semibold text-ink-2">Password</label>
                <div className="relative">
                  <input
                    id="signup-password"
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
                {password && (
                  <div className="mb-1 mt-3">
                    <div className="h-[5px] overflow-hidden rounded-full bg-ink/[0.1]">
                      <div
                        className={`h-full rounded-full transition-all ${passwordScore <= 1 ? 'bg-[#C0392B]' : passwordScore <= 3 ? 'bg-[#D97742]' : 'bg-forest'}`}
                        style={{ width: `${Math.max(12, passwordScore * 20)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[12.5px] text-ink-muted">
                      <span className="font-semibold text-ink-2">{passwordLabel}.</span>{' '}
                      {password.length < 8 ? 'Start with at least 8 characters.' : 'Length plus a mix of letters, numbers, and symbols is strongest.'}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-6 w-full rounded-[9px] bg-terracotta py-[14px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] transition hover:bg-terracotta-hover disabled:opacity-50"
                >
                  {loading ? 'Creating your account…' : 'Create account'}
                </button>
              </form>

              <p className="mt-5 text-center text-[12.5px] leading-[1.6] text-ink-muted">
                By creating an account, you agree to the{' '}
                <Link href="/terms" className="font-semibold text-ink-2 underline decoration-ink/30 underline-offset-2">Terms</Link>{' '}
                and{' '}
                <Link href="/privacy" className="font-semibold text-ink-2 underline decoration-ink/30 underline-offset-2">Privacy Policy</Link>.
                The trial runs 14 days; after that, InvoiceIQ is $99 per location/month unless you cancel. No card is required today.
              </p>

              <div className="mt-7 rounded-[12px] border border-ink/[0.08] bg-cream-surface px-5 py-4 md:hidden">
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">What you get</div>
                <ul className="space-y-2 text-[14px] text-ink-2">
                  <li><span className="mr-2 text-pop">✓</span>First invoice read in minutes</li>
                  <li><span className="mr-2 text-pop">✓</span>Review keeps uncertain reads out of totals</li>
                  <li><span className="mr-2 text-pop">✓</span>Cancel anytime from billing settings</li>
                </ul>
              </div>

              <p className="mt-[30px] text-center text-[14px] text-ink-3">
                Already have an account?{' '}
                <Link href="/login" className="font-semibold text-pop hover:text-pop-hover">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>

      {/* RIGHT: visual (hidden on mobile) */}
      <div className="relative hidden flex-col justify-center bg-coal px-14 py-10 text-[#EDEFE8] md:flex">
        <div className="mx-auto w-full max-w-[440px]">
          <p className="mb-[10px] font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-pop">What you get</p>
          <p className="mb-[28px] font-serif text-[34px] font-normal leading-[1.25] text-cream">
            Open the books without opening a spreadsheet.
          </p>
          <ul className="space-y-[16px] text-[15.5px] leading-[1.55] text-[#DDE7E0]">
            <li className="flex gap-[12px]"><span className="mt-[2px] font-bold text-pop">✓</span><span><strong className="font-semibold text-cream">14 days free.</strong> No card today; $99 per location/month only if you stay.</span></li>
            <li className="flex gap-[12px]"><span className="mt-[2px] font-bold text-pop">✓</span><span><strong className="font-semibold text-cream">First invoice in minutes.</strong> Photo, PDF, CSV, or a supplier email.</span></li>
            <li className="flex gap-[12px]"><span className="mt-[2px] font-bold text-pop">✓</span><span><strong className="font-semibold text-cream">A human checkpoint.</strong> Uncertain reads wait in Review before they touch a total.</span></li>
            <li className="flex gap-[12px]"><span className="mt-[2px] font-bold text-pop">✓</span><span><strong className="font-semibold text-cream">The whole picture.</strong> Food cost, price alerts, recipe costing, and Ask in one account.</span></li>
            <li className="flex gap-[12px]"><span className="mt-[2px] font-bold text-pop">✓</span><span><strong className="font-semibold text-cream">No lock-in theatre.</strong> Cancel anytime from billing settings.</span></li>
          </ul>
          <div className="mt-9 grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-4">
              <div className="font-display text-[24px] font-extrabold text-cream">500+</div>
              <div className="mt-1 text-[12.5px] text-cream/60">pilot invoices processed</div>
            </div>
            <div className="rounded-[12px] border border-white/10 bg-white/[0.05] px-4 py-4">
              <div className="font-display text-[24px] font-extrabold text-cream">99%+</div>
              <div className="mt-1 text-[12.5px] text-cream/60">accuracy in hand-checked samples</div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-14 font-serif text-[20px] text-[rgba(247,243,237,.55)]">
          getinvoiceIQ<span className="text-terracotta-hover">.</span>
        </div>
      </div>
    </div>
  )
}
