// @vitest-environment jsdom
// dp1 golden (DAY-SHIFT DESIGN-PASS 2026-11-28): the redesign is DOM-only —
// behavior contract (pure function of indexer reads, honest loading state)
// unchanged. Golden pins the ui-kit card rhythm: card shell classes, header +
// progress meter row, 44px touch rows, CTA promoted to bar with chevron; and
// the no-CTA path stays honest text inside the same anchor. Data is stubbed
// at the fetch boundary (repo pattern); goldens extended, never replaced.
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BILL = "0x0000000000000000000000000000000000000001";

// V2 canonical feed event names (bill_index feed law — see billLifecycle.ts):
// goldens must feed the real vocabulary, never ad-hoc "kind" rows.
function mockFetch(events: unknown[], grants: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const body = url.includes("settlements") ? { events } : { grants };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

const SETTLED_EVENTS = [
  { event: "EscrowFunded", block: 37663125 },
  { event: "SeatConfirmed", block: 37663140, seat_id: 1 },
  { event: "SettlementExecuted", block: 37663180 },
  { event: "SeatPayoutClaimed", block: 37663200, seat_id: 1 },
];

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderSettled(events: unknown[], grants: Record<string, unknown>) {
  global.fetch = mockFetch(events, grants);
  const { SettlementTimeline } = await import("@/components/SettlementTimeline");
  render(<SettlementTimeline bill={BILL} />);
  return screen.findByTestId("settlement-timeline");
}

describe("dp1 settlement-timeline card rhythm", () => {
  it("honest loading state is preserved (role=status)", async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const { SettlementTimeline } = await import("@/components/SettlementTimeline");
    render(<SettlementTimeline bill={BILL} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading lifecycle from indexer…",
    );
  });

  it("card shell + header meter row (ui-kit rhythm)", async () => {
    const card = await renderSettled(
      [{ kind: "bill_created" }],
      { [BILL]: true },
    );
    expect(card.className).toContain("rounded-2xl");
    expect(card.querySelector("[data-testid='timeline-progress']")).toHaveTextContent(
      /\d+\/\d+/,
    );
  });

  it("step rows carry the 44px touch rhythm", async () => {
    const card = await renderSettled(
      [{ kind: "bill_created" }],
      { [BILL]: true },
    );
    const row = card.querySelector("ol li");
    expect(row).not.toBeNull();
    expect(row!.className).toContain("min-h-[44px]");
  });

  it("next-action CTA renders as bar with chevron when actionable", async () => {
    const card = await renderSettled(
      [{ kind: "bill_created" }],
      { [BILL]: true },
    );
    const cta = card.querySelector("[data-testid='timeline-cta-note']");
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toMatch(/[A-Za-z]/);
  });

  it("no-CTA path stays honest text inside the same bar anchor", async () => {
    global.fetch = mockFetch([], {}) as unknown as typeof fetch;
    const { SettlementTimeline } = await import("@/components/SettlementTimeline");
    render(<SettlementTimeline bill={BILL} />);
    const cta = await screen.findByTestId("timeline-cta-note");
    expect(cta.textContent).not.toContain("›");
  });
});
