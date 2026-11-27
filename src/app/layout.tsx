import { auth } from '@/auth';
import ClientProviders from '@/providers';
import '@worldcoin/mini-apps-ui-kit-react/styles.css';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Tanda — proof-escrow settlement between provably-unique humans',
  description:
    'Settled by contract, not trust: every seat is a World ID, every payout a pull-claim on-chain receipt. Group bills run the same escrow law — USDC from day one, zero fees, no custody.',
  // QUALITY WAVE 1 (I2): link previews + canonical identity. OG image reuses
  // the brand icon until a designed card ships (backlog I-list #14); honest
  // copy law applies to og:description exactly as to <title>.
  openGraph: {
    title: 'TandaBill — escrowed settlement between verified humans',
    description:
      'Every seat is a World ID. Every payout is an on-chain pull-claim. USDC escrow from day one.',
    url: 'https://tanda-miniapp.vercel.app',
    siteName: 'TandaBill',
    type: 'website',
    images: [{ url: '/icon-512.png', width: 512, height: 512, alt: 'TandaBill mark' }],
  },
  twitter: { card: 'summary_large_image', title: 'TandaBill', description: 'Escrowed settlement between verified humans.' },
  icons: { icon: '/favicon.ico', apple: '/icon-192.png' },
  manifest: '/manifest.webmanifest',
};

// SSR-SHELL (V5 audit card 1, white-screen kill): an unbounded `await auth()`
// in the root layout blocks time-to-first-byte for EVERY lane — inside World
// App on a mid-range phone the served body was title-only until the IdP
// returned. Session is an enhancement, not a gate: race it against a 1.5s
// budget and fall through with null (ClientProviders already types
// session: Session | null — signed-out is a supported state, blank is not).
const SESSION_BUDGET_MS = 1500;

async function sessionWithBudget() {
  try {
    return await Promise.race([
      auth(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_BUDGET_MS)),
    ]);
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await sessionWithBudget();
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} `}>
        <ClientProviders session={session}>{children}</ClientProviders>
      </body>
    </html>
  );
}
