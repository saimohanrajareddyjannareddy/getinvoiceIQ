import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { AuthProvider } from '@/lib/auth'
import { RestaurantProvider } from '@/lib/restaurant'

// mise design system fonts (from Claude Design handoff):
// Instrument Serif — display / headings, Inter — body, IBM Plex Mono — numbers/data.
// Self-hosted from app/fonts (see the README there): next/font/google
// downloads at build time, and a failed download fails the deploy.
const instrumentSerif = localFont({
  variable: '--font-instrument-serif',
  src: [
    { path: './fonts/instrument-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/instrument-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
})

const inter = localFont({
  variable: '--font-inter',
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
})

// Display grotesque for the 2026-10-29 reskin — heavy weights carry
// the wordmark, greetings and big numbers.
const archivo = localFont({
  variable: '--font-archivo',
  src: './fonts/archivo-latin-wght-normal.woff2',
  weight: '100 900',
})

const plexMono = localFont({
  variable: '--font-plex-mono',
  src: [
    { path: './fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
})

export const metadata: Metadata = {
  title: 'getinvoiceIQ — Restaurant Invoice & Food Cost Software',
  description:
    'Snap a receipt or forward an email and getinvoiceIQ reads every line: spend, price alerts, food cost, and recipe costing for independent restaurants. $99 per location/month after a 14-day free trial.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${plexMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <RestaurantProvider>{children}</RestaurantProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
