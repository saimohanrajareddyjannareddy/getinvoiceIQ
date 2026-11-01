import Link from 'next/link'

/*
 * InvoiceIQ — public landing page.
 * A server component written in the product's own voice: it leads with the
 * outcome, shows the product, prints the real $99 price, and answers the
 * questions an owner asks before trusting software with supplier paperwork.
 */
const SHOW_DASHBOARD_CALLOUT = true

// Decorative motion from the design, scoped to this page (globals.css stays
// limited to token/font wiring). Honors prefers-reduced-motion.
const animations = `
  @keyframes miseFloat { 0%,100% { transform: translateY(0) rotate(-1.2deg); } 50% { transform: translateY(-14px) rotate(-1.2deg); } }
  @keyframes miseRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes miseChip { 0% { opacity: 0; transform: translateX(-6px); } 100% { opacity: 1; transform: translateX(0); } }
  @keyframes misePulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
  @keyframes miseShimmer { 0% { background-position: -180px 0; } 100% { background-position: 220px 0; } }
  @media (prefers-reduced-motion: reduce) { .mise-anim { animation: none !important; } }
`

const shimmer =
  'linear-gradient(90deg, rgba(30,58,47,.09) 0%, rgba(30,58,47,.16) 40%, rgba(30,58,47,.09) 80%)'
const shimmerAccent =
  'linear-gradient(90deg, rgba(236,72,153,.14) 0%, rgba(236,72,153,.26) 40%, rgba(236,72,153,.14) 80%)'

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-cream font-sans text-ink">
      <style dangerouslySetInnerHTML={{ __html: animations }} />

      {/* BLACK BAND — nav + hero */}
      <div className="bg-coal">
      {/* NAV */}
      <nav className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-[26px] md:px-10">
        <div className="flex items-baseline gap-0.5 font-display text-[28px] font-extrabold tracking-[-0.5px] text-cream">
          <span>InvoiceIQ</span>
          <span className="text-[34px] leading-[0] text-pop">.</span>
        </div>
        <div className="flex items-center gap-5 md:gap-[34px]">
          <Link href="#features" className="hidden text-[15px] font-medium text-cream/70 hover:text-cream md:inline">
            Features
          </Link>
          <Link href="#how-it-works" className="hidden text-[15px] font-medium text-cream/70 hover:text-cream lg:inline">
            How it works
          </Link>
          <Link href="#pricing" className="hidden text-[15px] font-medium text-cream/70 hover:text-cream md:inline">
            Pricing
          </Link>
          <Link href="#faq" className="hidden text-[15px] font-medium text-cream/70 hover:text-cream lg:inline">
            FAQ
          </Link>
          <Link href="/login" className="hidden text-[15px] font-medium text-cream/70 hover:text-cream md:inline">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-[8px] bg-terracotta px-5 py-[11px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_1px_2px_rgba(196,100,45,.35)] hover:bg-terracotta-hover"
          >
            Start free trial
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <header className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-14 px-6 pb-10 pt-[60px] md:grid-cols-[1.05fr_0.95fr] md:px-10">
        <div>
          <p className="mb-5 font-mono text-[12px] font-semibold uppercase tracking-[0.22em] text-pop">
            Invoice intelligence for independent restaurants
          </p>
          <h1 className="mb-6 font-display text-[42px] font-black uppercase leading-[0.98] tracking-[-1px] text-cream md:text-[76px] md:leading-[0.95]">
            Know where every dollar goes.
            <br />
            <span className="font-serif normal-case italic tracking-normal text-pop">Before your accountant does.</span>
          </h1>
          <p className="mb-8 max-w-[520px] text-[19px] leading-[1.55] text-cream/70">
            Snap a receipt, forward an email, or upload a PDF. InvoiceIQ turns supplier paperwork into food-cost
            answers while the week is still fixable.
          </p>
          <div className="flex flex-col gap-[10px] sm:flex-row">
            <Link
              href="/signup"
              className="flex items-center justify-center whitespace-nowrap rounded-[9px] bg-terracotta px-6 py-[15px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] hover:bg-terracotta-hover"
            >
              Start your free trial
            </Link>
            <Link
              href="#product"
              className="flex items-center justify-center whitespace-nowrap rounded-[9px] border border-white/25 px-6 py-[15px] text-[15px] font-semibold text-cream transition hover:bg-white/[0.07]"
            >
              See the product
            </Link>
          </div>
          <p className="mt-[14px] flex flex-wrap items-center gap-x-[7px] gap-y-1 text-[13.5px] text-cream/60">
            <span><span className="text-pop">✓</span> 14 days free</span>
            <span aria-hidden="true">·</span><span>No card to start</span>
            <span aria-hidden="true">·</span><span>Set up in minutes</span>
          </p>
        </div>

        {/* HERO DATA ELEMENT: decoding invoice card */}
        <div className="relative h-[460px]">
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(120% 90% at 70% 20%, rgba(236,72,153,.16), transparent 60%)' }}
          />
          <div className="mise-anim absolute right-0 top-[30px] w-[380px] max-w-full overflow-hidden rounded-[16px] border border-ink/10 bg-cream-surface shadow-[0_30px_60px_-22px_rgba(30,58,47,.35)] [animation:miseFloat_7s_ease-in-out_infinite]">
            <div className="flex items-center justify-between border-b border-white/10 bg-[#221E1A] px-5 py-4 text-cream">
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-cream/50">Vendor invoice</div>
                <div className="mt-0.5 font-serif text-[21px] leading-[1.1]">Restaurant Depot</div>
              </div>
              <div className="inline-flex items-center gap-[6px] rounded-full bg-pop/20 px-[10px] py-[5px] text-[11px] font-semibold text-[#F9A8D4]">
                <span className="mise-anim h-[6px] w-[6px] rounded-full bg-terracotta-hover [animation:misePulse_1.6s_ease-in-out_infinite]" />
                Decoding
              </div>
            </div>
            <div className="px-3 pb-[14px] pt-2">
              <div className="font-mono text-[13px]">
                <div className="grid grid-cols-[1fr_auto_auto] border-b border-ink/[0.08] px-2 pb-[10px] pt-2 text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
                  <span>Line item</span>
                  <span className="pr-[18px] text-right">Qty</span>
                  <span className="text-right">Unit $</span>
                </div>
                <div className="mise-anim grid grid-cols-[1fr_auto_auto] border-b border-ink/[0.05] px-2 py-[10px] [animation:miseRise_.5s_ease_both_.2s]">
                  <span className="text-ink">Yellow onions, 50lb</span>
                  <span className="pr-[18px] text-right text-ink-3">2</span>
                  <span className="text-right font-semibold text-terracotta">$18.40 ↑</span>
                </div>
                <div className="mise-anim grid grid-cols-[1fr_auto_auto] border-b border-ink/[0.05] px-2 py-[10px] [animation:miseRise_.5s_ease_both_.38s]">
                  <span className="text-ink">Roma tomatoes, case</span>
                  <span className="pr-[18px] text-right text-ink-3">4</span>
                  <span className="text-right text-ink">$22.10</span>
                </div>
                <div className="mise-anim grid grid-cols-[1fr_auto_auto] border-b border-ink/[0.05] px-2 py-[10px] [animation:miseRise_.5s_ease_both_.56s]">
                  <span className="text-ink">Chicken thighs, 40lb</span>
                  <span className="pr-[18px] text-right text-ink-3">3</span>
                  <span className="text-right font-semibold text-forest">$54.80 ↓</span>
                </div>
                <div className="mise-anim grid grid-cols-[1fr_auto_auto] items-center px-2 py-3 [animation:miseRise_.5s_ease_both_.74s]">
                  <span
                    className="mise-anim h-[11px] w-[130px] rounded-[4px] [animation:miseShimmer_1.3s_linear_infinite]"
                    style={{ background: shimmer, backgroundSize: '220px 100%' }}
                  />
                  <span
                    className="mise-anim mr-[18px] h-[11px] w-[14px] justify-self-end rounded-[4px] [animation:miseShimmer_1.3s_linear_infinite]"
                    style={{ background: shimmer, backgroundSize: '220px 100%' }}
                  />
                  <span
                    className="mise-anim h-[11px] w-[52px] justify-self-end rounded-[4px] [animation:miseShimmer_1.3s_linear_infinite]"
                    style={{ background: shimmerAccent, backgroundSize: '220px 100%' }}
                  />
                </div>
              </div>
            </div>
          </div>
          {/* floating alert chip */}
          <div className="mise-anim absolute bottom-[34px] left-0 max-w-[250px] rounded-[12px] bg-ink px-[18px] py-[14px] text-cream shadow-[0_20px_40px_-16px_rgba(0,0,0,.5)] ring-1 ring-white/15 [animation:miseChip_.6s_ease_both_1s]">
            <div className="mb-[5px] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#F9A8D4]">Price alert</div>
            <div className="text-[14px] leading-[1.35]">
              Yellow onions <span className="font-mono font-semibold text-[#F9A8D4]">↑ 22%</span> this week
            </div>
          </div>
        </div>
      </header>

      {/* PROMO FILM — the 12-second product story. Its own art is the
          same black/cream/pop world as this band, so it sits inside the
          hero as a silent looping showcase under the headline block. */}
      <div className="mx-auto max-w-[1240px] px-6 pb-[72px] md:px-10">
        <video
          className="w-full rounded-[20px] border border-white/10 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.65)]"
          src="/invoiceiq-promo.mp4"
          poster="/invoiceiq-promo-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="InvoiceIQ in twelve seconds: snap a photo of any invoice, InvoiceIQ reads every line, and you know where every dollar goes."
        />
      </div>
      </div>

      {/* PILOT PROOF — real operating numbers, labelled as pilot results. */}
      <section className="border-b border-ink/[0.08]">
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-6 px-6 py-9 text-center sm:grid-cols-3 md:px-10">
          <div>
            <div className="font-display text-[34px] font-extrabold leading-none text-ink">500+</div>
            <p className="mt-2 text-[13.5px] text-ink-muted">invoices processed during pilot use</p>
          </div>
          <div>
            <div className="font-display text-[34px] font-extrabold leading-none text-ink">99%+</div>
            <p className="mt-2 text-[13.5px] text-ink-muted">field accuracy in hand-checked samples</p>
          </div>
          <div>
            <div className="font-display text-[34px] font-extrabold leading-none text-ink">Minutes</div>
            <p className="mt-2 text-[13.5px] text-ink-muted">from photo to review-ready line items</p>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="mx-auto max-w-[1240px] scroll-mt-8 px-6 py-16 md:px-10 md:py-20">
        <div className="mb-10 max-w-[720px]">
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-terracotta">What it handles</div>
          <h2 className="font-serif text-[34px] font-normal leading-[1.05] tracking-[-0.5px] text-ink md:text-[46px]">
            The paperwork disappears. The numbers stay.
          </h2>
          <p className="mt-4 text-[16.5px] leading-[1.6] text-ink-3">
            Six jobs move off your counter and into one place: capture, checking, food cost, price changes, recipes,
            and plain-language answers.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-[22px] md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[16px] border border-ink/[0.08] bg-cream-surface px-7 py-[30px]">
            <div className="mb-[22px] flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-forest/[0.07]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1E3A2F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </div>
            <h3 className="mb-2 font-serif text-[25px] font-normal text-ink">Capture without typing</h3>
            <p className="text-[15px] leading-[1.55] text-ink-3">Use the camera, upload files, or let a Gmail scan find supplier invoices. Line items are ready in minutes, not days.</p>
          </div>

          <div className="rounded-[16px] border border-ink/[0.08] bg-cream-surface px-7 py-[30px]">
            <div className="mb-[22px] flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-terracotta/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3M20 16V6" /></svg>
            </div>
            <h3 className="mb-2 font-serif text-[25px] font-normal text-ink">Food cost on one screen</h3>
            <p className="text-[15px] leading-[1.55] text-ink-3">Approved purchases sit beside Clover sales, so the percentage you run the kitchen by is not split across reports.</p>
          </div>

          <div className="rounded-[16px] border border-ink/[0.08] bg-cream-surface px-7 py-[30px]">
            <div className="mb-[22px] flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-forest/[0.07]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1E3A2F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 4 3 6-8" /><path d="M18 4h3v3" /></svg>
            </div>
            <h3 className="mb-2 font-serif text-[25px] font-normal text-ink">Price moves, flagged early</h3>
            <p className="text-[15px] leading-[1.55] text-ink-3">Items moving 5% or more surface in alerts; moves of 20% or more are marked as the ones to look at first.</p>
          </div>

          <div className="rounded-[16px] border border-ink/[0.08] bg-cream-surface px-7 py-[30px]">
            <div className="mb-[22px] flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-terracotta/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 10v11M18 3c-2 1-3 3-3 6 0 2 1 3 3 3v9M18 3v18" /></svg>
            </div>
            <h3 className="mb-2 font-serif text-[25px] font-normal text-ink">Recipes priced from real bills</h3>
            <p className="text-[15px] leading-[1.55] text-ink-3">Start with the dish as your kitchen makes it. InvoiceIQ prices it from the latest approved invoices and keeps components like sauces costed too.</p>
          </div>

          <div className="rounded-[16px] border border-ink/[0.08] bg-cream-surface px-7 py-[30px]">
            <div className="mb-[22px] flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-forest/[0.07]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1E3A2F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /><path d="M8.5 11h7M8.5 14h4" /></svg>
            </div>
            <h3 className="mb-2 font-serif text-[25px] font-normal text-ink">Ask instead of digging</h3>
            <p className="text-[15px] leading-[1.55] text-ink-3">Ask what changed, what a category cost, or how much of an item you bought. Answers come from approved records, not guesses.</p>
          </div>

          <div className="rounded-[16px] border border-ink/[0.08] bg-cream-surface px-7 py-[30px]">
            <div className="mb-[22px] flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-terracotta/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h11l5 5v11H4z" /><path d="M14 4v5h5M7 13h8M7 17h5" /></svg>
            </div>
            <h3 className="mb-2 font-serif text-[25px] font-normal text-ink">Built for how you buy</h3>
            <p className="text-[15px] leading-[1.55] text-ink-3">Restaurant Depot checkout slips, cash-and-carry receipts, local wholesalers, and handwritten corrections belong here too.</p>
          </div>
        </div>
      </section>

      {/* DASHBOARD PREVIEW */}
      <section id="product" className="mx-auto max-w-[1240px] scroll-mt-8 px-6 pb-[72px] pt-6 md:px-10">
        <div className="mb-9 text-center">
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-terracotta">Inside the product</div>
          <h2 className="font-serif text-[34px] font-normal leading-[1.05] tracking-[-0.5px] text-ink md:text-[46px]">
            Start the day with the answer, not a spreadsheet
          </h2>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-ink/10 bg-cream-surface shadow-[0_40px_80px_-30px_rgba(30,58,47,.4)]">
          {/* window bar */}
          <div className="flex items-center gap-2 border-b border-ink/[0.08] bg-[#EFEAE0] px-[18px] py-[13px]">
            <span className="h-[11px] w-[11px] rounded-full bg-[#D9877A]" />
            <span className="h-[11px] w-[11px] rounded-full bg-[#E4C07A]" />
            <span className="h-[11px] w-[11px] rounded-full bg-[#9DBF9E]" />
            <span className="ml-[14px] font-mono text-[12px] text-ink-muted">getinvoiceiq.com/dashboard</span>
          </div>

          <div className="grid md:grid-cols-[220px_1fr]">
            {/* sidebar (desktop only) */}
            <aside className="hidden min-h-[460px] bg-coal px-4 py-[22px] text-[#E8E2D6] md:block">
              <div className="px-2 pb-[22px] font-display text-[22px] font-extrabold tracking-tight text-cream">
                InvoiceIQ<span className="text-terracotta-hover">.</span>
              </div>
              <div className="flex flex-col gap-[3px] text-[14px]">
                <div className="rounded-[8px] bg-pop/20 px-3 py-[9px] font-semibold text-white">Price tracker</div>
                <div className="rounded-[8px] px-3 py-[9px] text-[#C9C2B4]">Invoices</div>
                <div className="rounded-[8px] px-3 py-[9px] text-[#C9C2B4]">Vendors</div>
                <div className="rounded-[8px] px-3 py-[9px] text-[#C9C2B4]">Food cost %</div>
                <div className="rounded-[8px] px-3 py-[9px] text-[#C9C2B4]">Alerts</div>
              </div>
              <div className="mt-[26px] px-3 text-[10.5px] uppercase tracking-[0.08em] text-[#8A8377]">Categories</div>
              <div className="mt-2 flex flex-col gap-[3px] text-[14px]">
                <div className="flex justify-between rounded-[8px] px-3 py-2 text-[#C9C2B4]"><span>Produce</span><span className="font-mono text-[#F9A8D4]">↑</span></div>
                <div className="flex justify-between rounded-[8px] px-3 py-2 text-[#C9C2B4]"><span>Protein</span><span className="font-mono text-[#9DBF9E]">↓</span></div>
                <div className="flex justify-between rounded-[8px] px-3 py-2 text-[#C9C2B4]"><span>Dry goods</span><span className="font-mono text-forest-light">→</span></div>
              </div>
            </aside>

            {/* main */}
            <main className="px-[30px] py-[26px]">
              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                {/* price tracker (compact) */}
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <div>
                      <h3 className="m-0 font-serif text-[22px] font-normal text-ink">Price tracker</h3>
                      <p className="mt-[3px] text-[12px] text-ink-muted">Trailing 6 weeks · 3 vendors</p>
                    </div>
                  </div>
                  <div className="relative rounded-[12px] border border-ink/[0.07] bg-cream-surface-alt px-[14px] pb-[6px] pt-3">
                    <svg viewBox="0 0 620 220" className="block h-[82px] w-full" preserveAspectRatio="none">
                      <line x1="0" y1="40" x2="620" y2="40" stroke="rgba(26,23,19,.06)" strokeWidth="1" />
                      <line x1="0" y1="90" x2="620" y2="90" stroke="rgba(26,23,19,.06)" strokeWidth="1" />
                      <line x1="0" y1="140" x2="620" y2="140" stroke="rgba(26,23,19,.06)" strokeWidth="1" />
                      <line x1="0" y1="190" x2="620" y2="190" stroke="rgba(26,23,19,.06)" strokeWidth="1" />
                      <polyline points="10,150 110,146 210,140 310,128 410,112 510,74 610,44" fill="none" stroke="#EC4899" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="610" cy="44" r="5" fill="#EC4899" />
                      <polyline points="10,108 110,112 210,106 310,110 410,104 510,108 610,105" fill="none" stroke="#8A8377" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="10,96 110,104 210,118 310,128 410,146 510,158 610,170" fill="none" stroke="#1E3A2F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="610" cy="170" r="5" fill="#1E3A2F" />
                    </svg>
                    <div className="flex justify-between px-0.5 pb-0.5 pt-1 font-mono text-[10px] text-[#A69E90]">
                      <span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span><span>W6</span>
                    </div>
                    {SHOW_DASHBOARD_CALLOUT && (
                      <div className="absolute bottom-[26px] left-3 flex items-center gap-[7px] rounded-[8px] bg-ink px-[10px] py-[6px] font-mono text-[11px] text-cream shadow-[0_10px_24px_-10px_rgba(0,0,0,.45)]">
                        <span className="font-semibold text-[#F9A8D4]">Yellow onions ↑ 22%</span>
                        <span className="text-[#C7C0B4]">this week</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-[10px] flex gap-[6px] font-mono text-[11px]">
                    <span className="inline-flex items-center gap-[5px] rounded-[6px] bg-terracotta/10 px-2 py-[5px] text-terracotta"><span className="h-[3px] w-2 rounded-[2px] bg-terracotta" />Onions</span>
                    <span className="inline-flex items-center gap-[5px] rounded-[6px] bg-ink/[0.05] px-2 py-[5px] text-ink-3"><span className="h-[3px] w-2 rounded-[2px] bg-ink-muted" />Tomatoes</span>
                    <span className="inline-flex items-center gap-[5px] rounded-[6px] bg-forest/[0.08] px-2 py-[5px] text-forest"><span className="h-[3px] w-2 rounded-[2px] bg-forest" />Chicken</span>
                  </div>
                </div>

                {/* recent invoices */}
                <div>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h3 className="m-0 font-serif text-[22px] font-normal text-ink">Recent invoices</h3>
                    <span className="font-mono text-[11px] text-ink-muted">Last 7 days</span>
                  </div>
                  <div className="overflow-hidden rounded-[12px] border border-ink/[0.07] bg-cream-surface-alt">
                    <div className="flex items-center justify-between border-b border-ink/[0.06] px-[14px] py-[11px]">
                      <div><div className="text-[13px] text-ink">Restaurant Depot</div><div className="text-[11px] text-ink-muted">Jul 9 · 24 items</div></div>
                      <div className="text-right"><div className="font-mono text-[13px] text-ink">$1,842</div><span className="font-mono text-[10px] text-terracotta">2 price moves</span></div>
                    </div>
                    <div className="flex items-center justify-between border-b border-ink/[0.06] px-[14px] py-[11px]">
                      <div><div className="text-[13px] text-ink">Sysco Foods</div><div className="text-[11px] text-ink-muted">Jul 8 · 41 items</div></div>
                      <div className="text-right"><div className="font-mono text-[13px] text-ink">$3,210</div><span className="font-mono text-[10px] text-forest">no big moves</span></div>
                    </div>
                    <div className="flex items-center justify-between border-b border-ink/[0.06] px-[14px] py-[11px]">
                      <div><div className="text-[13px] text-ink">Baldor Specialty</div><div className="text-[11px] text-ink-muted">Jul 7 · 18 items</div></div>
                      <div className="text-right"><div className="font-mono text-[13px] text-ink">$964</div><span className="font-mono text-[10px] text-terracotta">1 price move</span></div>
                    </div>
                    <div className="flex items-center justify-between px-[14px] py-[11px]">
                      <div><div className="text-[13px] text-ink">Pacific Seafood</div><div className="text-[11px] text-ink-muted">Jul 6 · 9 items</div></div>
                      <div className="text-right"><div className="font-mono text-[13px] text-ink">$1,120</div><span className="font-mono text-[10px] text-forest">no big moves</span></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* stat row */}
              <div className="mt-[14px] grid grid-cols-1 gap-[14px] sm:grid-cols-3">
                <div className="rounded-[11px] border border-ink/[0.07] bg-cream-surface-alt px-4 py-[15px]">
                  <div className="text-[11.5px] tracking-[0.03em] text-ink-muted">Food cost this period</div>
                  <div className="mt-1 font-mono text-[26px] font-semibold text-ink">31.4<span className="text-[16px] text-ink-muted">%</span></div>
                  <div className="mt-0.5 font-mono text-[12px] text-terracotta">↑ 1.8 pts vs. last month</div>
                </div>
                <div className="rounded-[11px] border border-ink/[0.07] bg-cream-surface-alt px-4 py-[15px]">
                  <div className="text-[11.5px] tracking-[0.03em] text-ink-muted">Spend in this view</div>
                  <div className="mt-1 font-mono text-[26px] font-semibold text-ink">$7,136</div>
                  <div className="mt-0.5 font-mono text-[12px] text-ink-muted">across the invoices above</div>
                </div>
                <div className="rounded-[11px] border border-ink/[0.07] bg-cream-surface-alt px-4 py-[15px]">
                  <div className="text-[11.5px] tracking-[0.03em] text-ink-muted">Invoices parsed</div>
                  <div className="mt-1 font-mono text-[26px] font-semibold text-ink">318</div>
                  <div className="mt-0.5 font-mono text-[12px] text-ink-muted">across 7 vendors</div>
                </div>
              </div>
            </main>
          </div>
        </div>
        <p className="mt-4 text-center text-[12.5px] text-ink-muted">Illustrative product view using sample data.</p>
      </section>

      {/* ASK SPOTLIGHT */}
      <section className="mx-auto max-w-[1240px] px-6 pb-[84px] md:px-10">
        <div className="grid grid-cols-1 items-center gap-10 rounded-[22px] bg-coal px-7 py-12 text-cream md:px-12 lg:grid-cols-2">
          <div>
            <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-pop">Ask InvoiceIQ</div>
            <h2 className="font-serif text-[34px] font-normal leading-[1.05] text-cream md:text-[44px]">Ask the question you would ask your bookkeeper.</h2>
            <p className="mt-5 max-w-[520px] text-[16px] leading-[1.6] text-cream/70">
              No report hunting. Ask about a vendor, a category, or a single ingredient and get an answer from the
              invoices you approved and the sales you connected.
            </p>
            <div className="mt-7 flex flex-wrap gap-2 text-[13.5px] text-cream/80">
              <span className="rounded-full border border-white/15 px-3 py-1.5">“Which prices moved most?”</span>
              <span className="rounded-full border border-white/15 px-3 py-1.5">“What did dairy cost in October?”</span>
              <span className="rounded-full border border-white/15 px-3 py-1.5">“Why is food cost up?”</span>
            </div>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.05] p-5">
            <div className="ml-auto max-w-[85%] rounded-[14px] rounded-br-[4px] bg-pop px-4 py-3 text-[14.5px] font-medium text-white">
              What changed on our last Restaurant Depot run?
            </div>
            <div className="mt-4 max-w-[92%] rounded-[14px] rounded-bl-[4px] bg-cream px-4 py-3 text-[14.5px] leading-[1.55] text-ink">
              Chicken is steady. Yellow onions are up 22% from the prior purchase. Two lines are waiting in Review,
              so they are not counted in your totals yet.
            </div>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-cream/45">Sample conversation · answers use approved data only</p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="bg-coal text-[#EDEFE8]">
        <div className="mx-auto max-w-[1240px] px-6 py-[76px] md:px-10">
          <div className="mb-[52px] text-center">
            <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-pop">How it works</div>
            <h2 className="font-serif text-[34px] font-normal leading-[1.05] text-cream md:text-[46px]">
              From shoebox to checked numbers in three steps
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-[30px] md:grid-cols-3">
            <div>
              <div className="mb-[14px] font-mono text-[14px] text-pop">01</div>
              <h3 className="mb-[10px] font-serif text-[27px] font-normal text-cream">Add the paperwork</h3>
              <p className="text-[15px] leading-[1.55] text-[#C9C2B4]">
                Use the phone camera, upload files, or connect Gmail to find supplier invoices. Paper checkout slips and local-wholesaler bills are welcome.
              </p>
            </div>
            <div>
              <div className="mb-[14px] font-mono text-[14px] text-pop">02</div>
              <h3 className="mb-[10px] font-serif text-[27px] font-normal text-cream">Check the read</h3>
              <p className="text-[15px] leading-[1.55] text-[#C9C2B4]">
                Totals are recomputed in code. Anything uncertain waits in Review for a quick approve, edit, or deny — it never slips into your numbers.
              </p>
            </div>
            <div>
              <div className="mb-[14px] font-mono text-[14px] text-pop">03</div>
              <h3 className="mb-[10px] font-serif text-[27px] font-normal text-cream">Act while it matters</h3>
              <p className="text-[15px] leading-[1.55] text-[#C9C2B4]">
                Watch food cost, catch price moves, cost the next menu change, and ask questions from records you already checked.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE WEDGE */}
      <section className="mx-auto max-w-[1000px] px-6 py-[84px] md:px-10">
        <div className="text-center">
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-terracotta">The messy middle</div>
          <h2 className="font-serif text-[34px] font-normal leading-[1.05] text-ink md:text-[46px]">
            Made for the invoices other systems leave behind.
          </h2>
          <p className="mx-auto mt-5 max-w-[680px] text-[16.5px] leading-[1.6] text-ink-3">
            Plenty of tools love a clean distributor feed. Kitchens also run on checkout-lane paper, small wholesalers,
            handwriting in the margins, and a supplier whose name never prints the same way twice.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-[18px] sm:grid-cols-2">
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-5 text-[15.5px] font-medium text-ink">Paper receipts from Restaurant Depot and cash-and-carry runs</div>
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-5 text-[15.5px] font-medium text-ink">Local and ethnic wholesalers with no electronic feed</div>
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-5 text-[15.5px] font-medium text-ink">Handwritten slips get a human check before money counts</div>
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-5 text-[15.5px] font-medium text-ink">Supplier spellings are remembered, so Review gets faster</div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-[1000px] scroll-mt-8 px-6 pb-20 pt-5 md:px-10">
        <div className="mb-11 text-center">
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-terracotta">Pricing</div>
          <h2 className="font-serif text-[34px] font-normal leading-[1.05] text-ink md:text-[46px]">
            One price, printed in the open.
          </h2>
          <p className="mx-auto mt-4 max-w-[560px] text-[16px] leading-[1.6] text-ink-3">
            No quote call. No setup fee. No per-invoice meter running while you work.
          </p>
        </div>
        <div className="mx-auto max-w-[820px] rounded-[20px] bg-coal px-8 py-[38px] text-[#EDEFE8] shadow-[0_30px_60px_-28px_rgba(23,19,16,.55)] md:px-12">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-[0.9fr_1.1fr]">
            <div>
              <div className="text-[15px] font-semibold text-pop">InvoiceIQ</div>
              <div className="mb-[6px] mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="font-serif text-[64px] leading-none text-cream">$99</span>
                <span className="text-[15px] text-[#C9C2B4]">per location / month</span>
              </div>
              <p className="text-[14.5px] leading-[1.55] text-[#C9C2B4]">After a 14-day free trial. No card is required to start.</p>
              <Link href="/signup" className="mt-7 block rounded-[9px] bg-terracotta px-4 py-[14px] text-center text-[15px] font-semibold text-[#FDF8F0] shadow-[0_4px_14px_rgba(196,100,45,.4)] hover:bg-terracotta-hover">
                Start free trial
              </Link>
              <p className="mt-3 text-center text-[12.5px] text-cream/50">Cancel anytime from billing settings.</p>
            </div>
            <div>
              <div className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-cream/60">Everything is included</div>
              <div className="flex flex-col gap-[12px] text-[15px] text-[#DDE7E0]">
                <div className="flex gap-[10px]"><span className="text-pop">✓</span> Unlimited invoice uploads and Gmail scans</div>
                <div className="flex gap-[10px]"><span className="text-pop">✓</span> Review queue with totals recomputed</div>
                <div className="flex gap-[10px]"><span className="text-pop">✓</span> Clover sales sync and food-cost view</div>
                <div className="flex gap-[10px]"><span className="text-pop">✓</span> Price alerts at 5% and big moves at 20%</div>
                <div className="flex gap-[10px]"><span className="text-pop">✓</span> Recipe costing and Ask InvoiceIQ</div>
                <div className="flex gap-[10px]"><span className="text-pop">✓</span> Multiple restaurants under one account</div>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-[14px] text-ink-muted">Running more than one location? Each active location is $99/month.</p>
      </section>

      {/* INTEGRATIONS */}
      <section className="mx-auto max-w-[1240px] px-6 pb-20 md:px-10">
        <div className="mb-9 text-center">
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-terracotta">Connections</div>
          <h2 className="font-serif text-[34px] font-normal leading-[1.05] text-ink md:text-[44px]">Plugged into the tools already on your counter.</h2>
        </div>
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-6"><div className="font-display text-[20px] font-bold text-ink">Clover</div><p className="mt-2 text-[14.5px] leading-[1.55] text-ink-3">Daily sales sync, so purchases can be matched to what actually sold.</p></div>
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-6"><div className="font-display text-[20px] font-bold text-ink">Gmail</div><p className="mt-2 text-[14.5px] leading-[1.55] text-ink-3">Read-only scanning for supplier invoices. Every find waits for your approval.</p></div>
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-6"><div className="font-display text-[20px] font-bold text-ink">Photo · PDF · CSV</div><p className="mt-2 text-[14.5px] leading-[1.55] text-ink-3">The formats paper and portals actually give you — no special feed required.</p></div>
          <div className="rounded-[14px] border border-ink/[0.08] bg-cream-surface px-6 py-6"><div className="font-display text-[20px] font-bold text-ink">Stripe</div><p className="mt-2 text-[14.5px] leading-[1.55] text-ink-3">Secure subscription billing, receipts, and payment history inside Settings.</p></div>
        </div>
        <p className="mt-5 text-center text-[14px] text-ink-muted">No Clover? You can still track purchases, prices, and recipes from invoices alone.</p>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[900px] scroll-mt-8 px-6 pb-24 md:px-10">
        <div className="mb-9 text-center">
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-terracotta">FAQ</div>
          <h2 className="font-serif text-[34px] font-normal leading-[1.05] text-ink md:text-[44px]">Straight answers before you sign up.</h2>
        </div>
        <div className="divide-y divide-ink/[0.08] rounded-[16px] border border-ink/[0.08] bg-cream-surface px-6">
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">How accurate is the reading?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">The AI reads the document, then the totals are recomputed in code. In hand-checked pilot samples, field accuracy was above 99%. Anything that does not reconcile waits in Review instead of entering your reports.</p>
          </details>
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">How long does setup take?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">Minutes. Create the account, name the restaurant, and add a first invoice. There is no onboarding call and no implementation project.</p>
          </details>
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">What kinds of invoices work?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">Photos, PDFs, CSVs, and invoices found in Gmail — including Restaurant Depot checkout receipts, cash-and-carry bills, local wholesalers, and handwritten slips. Handwriting and unclear reads are routed to Review.</p>
          </details>
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">Do I need Clover?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">No. Invoice capture, price tracking, and recipes work from invoices alone. Connect Clover when you want purchases matched against sales for the food-cost view.</p>
          </details>
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">What happens if a read is wrong?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">Fix the supplier name or a line in Review, approve it when it is right, or deny an email import that should not be there. Only approved invoices count toward spend and food cost.</p>
          </details>
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">What does it cost after the trial?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">$99 per location per month. The trial lasts 14 days and does not require a card. You can cancel from billing settings.</p>
          </details>
          <details className="group py-5">
            <summary className="cursor-pointer text-[16.5px] font-semibold text-ink">Is my restaurant&apos;s data private?</summary>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-3">Each restaurant&apos;s records are isolated and scoped to its members. Gmail access is read-only, and email imports stay quarantined in Review until a person approves them.</p>
          </details>
        </div>
      </section>

      {/* FINAL CTA */}
      <section id="cta" className="mx-auto mb-5 max-w-[1240px] px-6 md:px-10">
        <div className="rounded-[22px] border border-white/10 bg-coal px-6 py-[72px] text-center md:px-10">
          <h2 className="mb-[18px] font-serif text-[40px] font-normal leading-[1.02] tracking-[-1px] text-cream md:text-[56px]">
            Find the leak before the month is gone.
          </h2>
          <p className="mx-auto mb-[28px] max-w-[560px] text-[16.5px] leading-[1.6] text-cream/65">
            Bring one real invoice. If the numbers are not clearer by the end of the trial, walk away with nothing owed.
          </p>
          <div className="flex flex-col justify-center gap-[10px] sm:flex-row">
            <Link href="/signup" className="flex items-center justify-center whitespace-nowrap rounded-[9px] bg-terracotta px-7 py-[15px] text-[15px] font-semibold text-[#FDF8F0] shadow-[0_2px_8px_rgba(196,100,45,.3)] hover:bg-terracotta-hover">
              Start your free trial
            </Link>
            <Link href="#pricing" className="flex items-center justify-center whitespace-nowrap rounded-[9px] border border-white/25 px-7 py-[15px] text-[15px] font-semibold text-cream transition hover:bg-white/[0.07]">
              See the $99 plan
            </Link>
          </div>
          <p className="mt-[16px] text-[13.5px] text-cream/50">14 days free · No card required · Cancel anytime</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-6 py-10 md:px-10">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink-muted">
          <span className="font-display text-[19px] font-extrabold tracking-tight text-ink">
            InvoiceIQ<span className="text-terracotta">.</span>
          </span>
          <span className="mx-1">·</span> hello@getinvoiceiq.com
        </div>
        <div className="flex flex-wrap gap-[22px] text-[13.5px]">
          <Link href="#features" className="text-ink-muted hover:text-ink-2">Features</Link>
          <Link href="#pricing" className="text-ink-muted hover:text-ink-2">Pricing</Link>
          <Link href="/terms" className="text-ink-muted hover:text-ink-2">Terms</Link>
          <Link href="/privacy" className="text-ink-muted hover:text-ink-2">Privacy</Link>
          <Link href="/login" className="text-ink-muted hover:text-ink-2">Sign in</Link>
        </div>
      </footer>
    </div>
  )
}
