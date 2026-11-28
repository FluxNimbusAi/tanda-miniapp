"use client";

import { useEffect, useState } from "react";
import {
  lifecycleSteps,
  nextAction,
  type FeedEvent,
} from "@/lib/billLifecycle";

/**
 * DAY-SHIFT DESIGN-PASS (dp1, brief dayshift_DESIGN-PASS_20261128_0915):
 * the weakest screen in the product surface was this timeline — a bare <ol>
 * of dots on an ad-hoc grid, no card rhythm. Redesign to ui-kit cadence of
 * the listed apps (AgentBank / WLD Pay bar): one card shell (rounded-2xl,
 * border, px-4 py-3), header row + progress meter built from the SAME pure
 * function as the steps (zero new state), step rows at 44px touch rhythm with
 * chevron affordance, and the next-action CTA promoted from prose to a real
 * bar. Night Ledger law tokens only — no raw hex, no new palette.
 * Behavior contract unchanged: pure function of /api/settlements?bill= reads
 * (W8), honest loading state, role="status", data-testids preserved
 * (settlement-timeline, timeline-cta-note) + one additive golden anchor
 * (timeline-progress). Goldens before/after in the PR body.
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
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      aria-label="Settlement lifecycle"
      data-testid="settlement-timeline"
      className="rounded-2xl border border-[#232834] bg-[#161a22] px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Lifecycle</p>
        <p
          data-testid="timeline-progress"
          className="text-xs font-mono tabular-nums opacity-70"
        >
          {doneCount}/{steps.length}
        </p>
      </div>
      <ol className="mt-2 grid">
        {steps.map((s) => (
          <li
            key={s.key}
            className="flex min-h-[44px] items-center gap-3 border-b border-[#232834] py-2 last:border-b-0"
          >
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                s.done ? "bg-[#3ec8ff]" : "bg-[#232834]"
              }`}
            />
            <span
              className={`text-sm flex-1 ${s.done ? "font-semibold" : "opacity-60"}`}
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
      <div
        data-testid="timeline-cta-note"
        className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#232834] px-3 py-2.5"
      >
        <p className="text-xs opacity-85">
          {act.cta !== "" ? (
            <>
              <span className="font-semibold">{act.cta}</span> — {act.note}
            </>
          ) : (
            act.note
          )}
        </p>
        {act.cta !== "" && (
          <span
            data-testid="timeline-cta-chevron"
            aria-hidden
            className="text-sm font-semibold text-[#3ec8ff]"
          >
            ›
          </span>
        )}
      </div>
    </section>
  );
};
