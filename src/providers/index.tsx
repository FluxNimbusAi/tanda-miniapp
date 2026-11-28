'use client';
import dynamic from 'next/dynamic';

// PERF-WAVE (CI Lighthouse mobile 70→80; TBT 860ms is the last gate to ≥90):
// minikit's provider chunk was 130.6 KiB of unused JS executing on load in a
// plain-browser audit. Gate it behind a client dynamic chunk: MiniKit only
// initializes inside World App (window.Telegram/MiniKit env), so deferring the
// import keeps runtime behavior identical for real sessions while removing the
// load-time main-thread cost for cold renders.
const MiniKitProvider = dynamic(() => import('@worldcoin/minikit-js/minikit-provider').then((c) => c.MiniKitProvider), { ssr: false });
import { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';



// Define props for ClientProviders
interface ClientProvidersProps {
  children: ReactNode;
  session: Session | null; // Use the appropriate type for session from next-auth
}

/**
 * ClientProvider wraps the app with essential context providers.
 *
 * - ErudaProvider:
 *     - Should be used only in development.
 *     - Enables an in-browser console for logging and debugging.
 *
 * - MiniKitProvider:
 *     - Required for MiniKit functionality.
 *
 * This component ensures both providers are available to all child components.
 */
export default function ClientProviders({
  children,
  session,
}: ClientProvidersProps) {
  return (
    <MiniKitProvider>
      <SessionProvider session={session}>{children}</SessionProvider>
    </MiniKitProvider>
  );
}
