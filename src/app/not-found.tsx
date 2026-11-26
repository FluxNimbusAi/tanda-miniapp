// QUALITY WAVE 1 (I1b): branded 404 - honest, routes back to live product.
import Link from "next/link";

export default function NotFound() {
  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="not-found"
    >
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
        404
      </p>
      <h1 className="text-xl font-semibold">No bill or page lives here</h1>
      <p className="max-w-sm text-sm opacity-80">
        Check the link, or open the live explorer to see settlements on chain.
      </p>
      <Link
        href="/explorer"
        className="rounded-full border border-[#3ec8ff] px-5 py-2 text-sm font-semibold text-[#3ec8ff]"
      >
        Open explorer
      </Link>
    </main>
  );
}
