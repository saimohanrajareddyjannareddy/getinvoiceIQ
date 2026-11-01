import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 text-center font-sans text-ink">
      <Link href="/" className="flex items-baseline gap-px font-display text-[24px] font-extrabold tracking-[-0.5px] text-ink">
        <span>getinvoiceIQ</span>
        <span className="text-[28px] leading-[0] text-terracotta">.</span>
      </Link>
      <h1 className="mt-10 font-display text-[40px] font-extrabold leading-none tracking-[-1px]">Page not found</h1>
      <p className="mt-4 max-w-[420px] text-[15.5px] leading-[1.65] text-ink-3">
        That link doesn&apos;t lead anywhere. It may have moved, or the address has a typo.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="rounded-md bg-pop px-5 py-3 text-[14px] font-semibold text-white hover:bg-pop-hover">Go home</Link>
        <Link href="/dashboard" className="rounded-md border border-ink/20 px-5 py-3 text-[14px] font-semibold text-ink">Open dashboard</Link>
      </div>
    </div>
  )
}
