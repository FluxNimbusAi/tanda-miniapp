"use client";
// QUALITY WAVE 1 (I1): app-wide route error boundary. Before this, any render
// throw in any route = Next's unstyled dev-style crash for the user. Copy law:
// honest register (no "something went wrong!" exclamation), retry is the only
// action promised; nothing claims money is lost or safe beyond the truth.
import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest is the operator handle; console keeps it out of the render tree
    console.error("tanda route error:", error?.message, error?.digest ?? "");
  }, [error]);

  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
      role="alert"
      data-testid="route-error"
    >
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
        Tanda
      </p>
      <h1 className="text-xl font-semibold">This part of the app hit a snag</h1>
      <p className="max-w-sm text-sm opacity-80">
        Your money is where the contract says it is. Nothing here changes
        escrow state - retry, or leave and come back.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-[#3ec8ff] px-5 py-2 text-sm font-semibold text-black"
      >
        Try again
      </button>
    </main>
  );
}
