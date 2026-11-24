"use client";

import { useEffect, useState } from "react";
import {
  lifecycleSteps,
  nextAction,
  type FeedEvent,
} from "@/lib/billLifecycle";

/**
 * ui-t1 P2+P1 (t_2a5cc6a7 tier "now"): vertical settlement timeline +
 * one-action CTA, both a PURE function of /api/settlements?bill= indexer
 * reads (W8: no client address guessing, no direct chain). Night Ledger
 * tokens; money/blocks use tabular-nums (P9 typography law); done steps
 * carry the blue signal, pending steps stay dim - accent discipline holds.
 */
export const SettlementTimeline = ({ bill }: { bill: string }) => {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [seatTotal, setSeatTotal] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch(`/api/settlements?bill=${encodeURIComponent(bill)}&page=1`).then((r) =>
        r.ok ? r.json() : Promise.reject(r.status),
      ),
      fetch(`/api/seat-grants?bill=${encodeURIComponent(bill)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([f, g]) => {
        if (!live) return;
        setEvents((f?.events ?? []) as FeedEvent[]);
        setSeatTotal(Object.keys(g?.grants ?? {}).length);
      })
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [bill]);

  if (events === null)
    return (
      <p className="text-xs opacity-70" role="status">
        Loading lifecycle from indexer…
      </p>
    );

  const steps = lifecycleSteps(events, seatTotal);
  const act = nextAction(events, seatTotal);
  return (
    <section
      aria-label="Settlement lifecycle"
      data-testid="settlement-timeline"
      className="grid gap-1"
    >
      <p className="text-xs font-semibold opacity-80">Lifecycle</p>
      <ol className="grid">
        {steps.map((s) => (
          <li key={s.key} className="flex items-baseline gap-2 py-1.5">
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                s.done ? "bg-[#3ec8ff]" : "bg-[#232834]"
              }`}
            />
            <span
              className={`text-sm ${s.done ? "font-semibold" : "opacity-60"}`}
            >
              {s.label}
            </span>
            {s.detail && (
              <span className="font-mono text-xs opacity-70 [font-variant-numeric:tabular-nums]">
                {s.detail}
              </span>
            )}
          </li>
        ))}
      </ol>
      {act.cta !== "" && (
        <p className="text-xs opacity-85" data-testid="timeline-cta-note">
          <span className="font-semibold">{act.cta}</span> — {act.note}
        </p>
      )}
      {act.cta === "" && (
        <p className="text-xs text-[#3ec8ff]" data-testid="timeline-cta-note">
          {act.note}
        </p>
      )}
    </section>
  );
};
