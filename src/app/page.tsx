import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ModeGate } from '@/components/ModeGate';

// W2.5-3 (t_14b21fee): route-level dual mode. MiniKit.isInstalled() -> full
// World App experience (hero + wallet auth); plain browser -> Read-Only Live
// Explorer over the :8096 indexer (PR #22 settlements + bill lifecycle
// readback). Gate is a client decision on isInstalled; SSR/unknown defaults
// to the Explorer so GitHub visitors see PRODUCT first, never the
// Open-in-World-App wall. Reversible: one PR, no env/deploy surface.
export default async function Home() {
  // APP-1 signed-in entry: an established session goes straight into the
  // app shell — splash-to-content like a native launch, not a gate page.
  const session = await auth();
  if (session) redirect("/home");
  return <ModeGate />;
}
