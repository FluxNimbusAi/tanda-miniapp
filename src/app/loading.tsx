// QUALITY WAVE 1 (I1c): route-level loading skeleton - replaces blank paint
// during RSC resolution; aria-busy marks the region for AT.
export default function Loading() {
  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6"
      aria-busy="true"
      data-testid="route-loading"
    >
      <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
      <div className="h-4 w-64 animate-pulse rounded bg-white/10" />
      <div className="h-4 w-52 animate-pulse rounded bg-white/10" />
      <p className="text-xs opacity-60">loading live state...</p>
    </main>
  );
}
