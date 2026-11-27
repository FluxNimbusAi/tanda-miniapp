"use client";

// BS-4.1 / UX3-#9 — Empty state that pulls to first value (example circle).
// Spec: UX3_SPEC_BS23_20261124.md (§4a-4e). Tokens: DESIGN-F @theme law —
// rose/red = action pink #ff3e7f, sky/blue = accent #3ec8ff, slate-400 = muted;
// NO raw hex outside @theme. Copy single-sourced from lib/emptyState.
import { useState } from "react";

import { Button } from "@worldcoin/mini-apps-ui-kit-react";

import { EMPTY_STATE_COPY } from "@/lib/emptyState";

const C = EMPTY_STATE_COPY;

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  const [showExplainer, setShowExplainer] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div
      className="flex w-full flex-col gap-4 rounded-xl border p-5"
      data-testid="empty-state"
    >
      <h2 className="text-2xl font-bold tracking-tight">{C.headline}</h2>
      <p className="text-base leading-relaxed text-slate-400">{C.body}</p>
      <p className="text-sm text-slate-400">{C.subnote}</p>

      {/* 4a: one primary CTA (action pink) + one secondary link (accent) */}
      <Button
        size="lg"
        className="w-full bg-rose-500 hover:bg-rose-600 text-white min-h-[44px]"
        onClick={onCreate}
        data-testid="empty-cta-create"
      >
        {C.ctaPrimary}
      </Button>
      <button
        type="button"
        className="self-start text-base text-sky-500 underline-offset-4 hover:underline min-h-[44px] min-w-[44px]"
        onClick={() => setShowExplainer((v) => !v)}
        aria-expanded={showExplainer}
        data-testid="empty-cta-explain"
      >
        {C.ctaSecondary}
      </button>

      {showExplainer && (
        <ol
          className="flex flex-col gap-2 rounded-lg border p-3"
          data-testid="empty-explainer"
        >
          {C.explainerSteps.map((s, i) => (
            <li key={s.title} className="text-sm">
              <span className="font-semibold text-sky-500 tabular-nums">
                {i + 1}. {s.title}
              </span>{" "}
              <span className="text-slate-400">{s.note}</span>
            </li>
          ))}
        </ol>
      )}

      {/* 4c: tap-to-load example circle — static fixture, never a fake live tick */}
      <button
        type="button"
        className="self-start rounded-full border px-4 py-2 text-sm text-slate-400 hover:text-sky-500 min-h-[44px]"
        onClick={() => setShowPreview((v) => !v)}
        aria-expanded={showPreview}
        data-testid="empty-preview-chip"
      >
        {C.previewChip}
      </button>
      {showPreview && (
        <div
          className="rounded-lg border p-3"
          data-testid="empty-example-circle"
          role="note"
        >
          <p className="font-semibold">{C.exampleCircle.title}</p>
          <p className="text-sm text-slate-400 tabular-nums">
            {C.exampleCircle.meta}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Example only — static preview, not a live bill.
          </p>
        </div>
      )}
    </div>
  );
}
