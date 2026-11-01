import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — getinvoiceIQ',
  description: 'What getinvoiceIQ collects, why, who processes it, and the choices an account owner has.',
}

const h2 = 'mt-10 font-serif text-[24px] font-normal text-ink'
const p = 'mt-3 text-[15.5px] leading-[1.65] text-ink-3'
const li = 'mt-2 text-[15.5px] leading-[1.65] text-ink-3'

export default function PrivacyPage() {
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
        <h1 className="font-display text-[40px] font-extrabold leading-none tracking-[-1px] text-ink">Privacy Policy</h1>
        <p className="mt-3 text-[13.5px] text-ink-muted">Last updated October 30, 2026</p>

        <h2 className={h2}>What we collect</h2>
        <ul className="list-disc pl-6">
          <li className={li}><strong className="text-ink-2">Account details</strong> — your name, email address, and the name of your restaurant when you sign up.</li>
          <li className={li}><strong className="text-ink-2">Restaurant records</strong> — invoices, receipts, and files you upload or connect; the line items, prices, vendors, recipes, and reports produced from them.</li>
          <li className={li}><strong className="text-ink-2">Connected accounts, only if you connect them</strong> — Gmail messages that look like supplier invoices (read-only access; we never send or delete mail), and Clover sales data used for the food-cost view.</li>
          <li className={li}><strong className="text-ink-2">Billing information</strong> — handled by Stripe. We see subscription status and payment history summaries; we do not store full card numbers.</li>
          <li className={li}><strong className="text-ink-2">Basic technical data</strong> — the logs needed to run, secure, and fix the service.</li>
        </ul>

        <h2 className={h2}>How we use it</h2>
        <p className={p}>
          To run the product: reading invoices, computing totals and food cost, watching prices, costing recipes,
          answering your questions about your own records, billing the subscription, and keeping the service secure.
          Invoices and other documents are sent to AI model providers solely to extract their contents for you.
        </p>

        <h2 className={h2}>What we do not do</h2>
        <ul className="list-disc pl-6">
          <li className={li}>We do not sell personal information.</li>
          <li className={li}>One restaurant cannot see another restaurant&apos;s invoices, prices, recipes, or sales. Workspaces are isolated per restaurant and scoped to their members.</li>
          <li className={li}>Email imports are treated as untrusted: they wait in a review queue and never enter reports until a person approves them.</li>
        </ul>

        <h2 className={h2}>Who processes data for us</h2>
        <p className={p}>
          A small set of service providers runs the infrastructure: hosting and database/authentication providers,
          Stripe for payments, Google if you connect Gmail, Clover if you connect your POS, and AI model providers
          for document extraction. They receive only what their part of the service needs.
        </p>

        <h2 className={h2}>Security</h2>
        <p className={p}>
          Connections to connected accounts use encrypted tokens. Access to each restaurant&apos;s records is enforced in
          the database by membership, and traffic to getinvoiceIQ is encrypted in transit. No system is perfect; if a
          problem affects your data, we will tell you.
        </p>

        <h2 className={h2}>Retention and deletion</h2>
        <p className={p}>
          Your records stay while your account is active so the reports keep working. The account owner can delete
          the account from Settings, which removes owned restaurants and their records. Some billing records may be
          kept where accounting or legal obligations require it.
        </p>

        <h2 className={h2}>Your choices</h2>
        <ul className="list-disc pl-6">
          <li className={li}>Disconnect Gmail or Clover at any time from Settings.</li>
          <li className={li}>Ask us to correct or export your information by writing to hello@getinvoiceiq.com.</li>
          <li className={li}>Delete your account from Settings whenever you choose.</li>
        </ul>

        <h2 className={h2}>Changes and contact</h2>
        <p className={p}>
          If this policy changes materially, the new version will be posted here with a new date. Questions:
          hello@getinvoiceiq.com.
        </p>
      </main>
    </div>
  )
}
