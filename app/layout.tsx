import type { Metadata } from 'next'
import { Archivo, Instrument_Serif, Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth'
import { RestaurantProvider } from '@/lib/restaurant'

// mise design system fonts (from Claude Design handoff):
// Instrument Serif — display / headings, Inter — body, IBM Plex Mono — numbers/data.
const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400', // Instrument Serif ships a single 400 weight
  style: ['normal', 'italic'],
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

// Display grotesque for the 2026-10-29 reskin — heavy weights carry
// the wordmark, greetings and big numbers.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
})

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
