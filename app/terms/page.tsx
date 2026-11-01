import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — getinvoiceIQ',
  description: 'The terms that govern an getinvoiceIQ account: the service, trials and billing, your data, and acceptable use.',
}

const h2 = 'mt-10 font-serif text-[24px] font-normal text-ink'
const p = 'mt-3 text-[15.5px] leading-[1.65] text-ink-3'
const li = 'mt-2 text-[15.5px] leading-[1.65] text-ink-3'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-cream font-sans text-ink">
      <header className="mx-auto flex max-w-[820px] items-center justify-between px-6 py-8">
        <Link href="/" className="flex items-baseline gap-px font-display text-[24px] font-extrabold tracking-[-0.5px] text-ink">
          <span>getinvoiceIQ</span>
          <span className="text-[28px] leading-[0] text-terracotta">.</span>
        </Link>
        <Link href="/signup" className="text-[14px] font-semibold text-pop hover:text-pop-hover">Start free trial</Link>
      </header>

      <main className="mx-auto max-w-[820px] px-6 pb-24">
        <h1 className="font-display text-[40px] font-extrabold leading-none tracking-[-1px] text-ink">Terms of Service</h1>
        <p className="mt-3 text-[13.5px] text-ink-muted">Last updated October 30, 2026</p>

        <h2 className={h2}>1. What getinvoiceIQ is</h2>
        <p className={p}>
          getinvoiceIQ is software for restaurants that captures supplier invoices and receipts, extracts their line
          items, and turns them into spend, price, food-cost, and recipe information. Some readings are produced by
          automated systems. Readings that cannot be verified are placed in a review queue, and only invoices a user
          approves are counted in reports.
        </p>

        <h2 className={h2}>2. Your account</h2>
        <ul className="list-disc pl-6">
          <li className={li}>You are responsible for the accuracy of the information you provide and for activity under your account.</li>
          <li className={li}>Keep your password private. Tell us promptly at hello@getinvoiceiq.com if you believe your account has been accessed by someone else.</li>
          <li className={li}>A restaurant workspace may be shared with its members. The account owner controls membership and is responsible for who is invited.</li>
        </ul>

        <h2 className={h2}>3. Trials and billing</h2>
        <ul className="list-disc pl-6">
          <li className={li}>New accounts include a 14-day free trial. No payment card is required to start the trial.</li>
          <li className={li}>After the trial, the subscription is $99 per month for each active restaurant location, billed through Stripe.</li>
          <li className={li}>You can cancel at any time from billing settings. Cancellation stops future renewals; amounts already charged for a period in progress are not refundable except where the law requires it.</li>
          <li className={li}>If pricing changes, we will say so in advance through the product or by email before the new price applies to you.</li>
        </ul>

        <h2 className={h2}>4. Your data and responsibilities</h2>
        <ul className="list-disc pl-6">
          <li className={li}>You keep ownership of the invoices, recipes, and other material you add. You give getinvoiceIQ permission to store and process that material only to run the service for you.</li>
          <li className={li}>Automated readings can be wrong. You are responsible for reviewing queued items before relying on them for purchasing, pricing, tax, or accounting decisions. getinvoiceIQ is an operational tool, not an accountant or tax adviser.</li>
          <li className={li}>Only add material you have the right to share with the service, including supplier documents belonging to your business.</li>
        </ul>

        <h2 className={h2}>5. Acceptable use</h2>
        <ul className="list-disc pl-6">
          <li className={li}>Do not attempt to access another restaurant&apos;s data, probe the service for vulnerabilities, or interfere with its operation.</li>
          <li className={li}>Do not use the service for unlawful purposes or upload material that infringes someone else&apos;s rights.</li>
          <li className={li}>Do not resell access to the service without written permission.</li>
        </ul>

        <h2 className={h2}>6. Availability and changes</h2>
        <p className={p}>
          We work to keep getinvoiceIQ available and accurate, but the service is provided as-is without a promise that
          it will be uninterrupted or error-free. Features may change as the product improves; material changes to
          these terms will be posted on this page with a new date.
        </p>

        <h2 className={h2}>7. Liability</h2>
        <p className={p}>
          To the extent allowed by law, getinvoiceIQ&apos;s total liability for claims arising from the service is limited to
          the amount you paid for the service in the three months before the claim. Neither party is liable for
          indirect or consequential losses such as lost profits.
        </p>

        <h2 className={h2}>8. Ending access</h2>
        <p className={p}>
          You may delete your account from Settings at any time. We may suspend or end accounts that break these
          terms or put other customers&apos; data at risk. After deletion, data is removed as described in the Privacy
          Policy.
        </p>

        <h2 className={h2}>9. Contact</h2>
        <p className={p}>Questions about these terms: hello@getinvoiceiq.com.</p>
      </main>
    </div>
  )
}
