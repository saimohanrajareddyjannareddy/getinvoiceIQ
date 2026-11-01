import Link from 'next/link'

/**
 * getinvoiceIQ — the animated brand mark for the pre-login pages.
 * Letters rise in one by one (~45ms apart), then the pink dot stamps
 * in last; plays once on mount and rests. The whole mark is a link
 * back to the home page — the behavior people expect from a logo.
 * Keyframes live in globals.css (.logo-letter / .logo-dot), with a
 * prefers-reduced-motion opt-out.
 */
export default function AnimatedWordmark() {
  const letters = 'getinvoiceIQ'.split('')
  return (
    <Link
      href="/"
      aria-label="getinvoiceIQ — back to the home page"
      className="flex w-fit items-baseline gap-px font-display text-[27px] font-extrabold tracking-[-0.5px] text-ink transition hover:opacity-80"
    >
      <span aria-hidden className="[display:contents]">
        {letters.map((ch, i) => (
          <span
            key={i}
            className="logo-letter"
            style={{ animationDelay: `${i * 45}ms` }}
          >
            {ch}
          </span>
        ))}
        <span
          className="logo-dot text-[32px] leading-[0] text-terracotta"
          style={{ animationDelay: `${letters.length * 45 + 30}ms` }}
        >
          .
        </span>
      </span>
    </Link>
  )
}
