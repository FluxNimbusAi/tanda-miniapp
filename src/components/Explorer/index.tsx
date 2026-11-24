"use client";
// W2.5-3 (t_14b21fee): Read-Only Live Explorer — the browser-facing product
// view for GitHub visitors (owner brief + Flux rank4). Reads ONLY through the
// app's own auth-free GET routes, which proxy the :8096 canonical indexer:
//   GET /api/live-status           -> indexer /health pipeline counts
//   GET /api/settlements?bill=&page= -> PR #22 settlement summaries +
//                                       bill lifecycle event ledger (SR-003 F12)
//   GET /api/seat-grants?bill=       -> verified-seat roster count
// HARD INVARIANTS (golden-pinned in ModeGate/__tests__):
//   1. Zero wallet affordances: no AuthButton, no Verify, no Pay/Transaction,
//      no MiniKit command — nothing that could transact.
//   2. GET-only network: this component never issues a mutating request.
//   3. Degrade, never error: indexer down -> offline chips + friendly copy.
import { useCallback, useEffect, useState } from "react";

type LiveStatus = {
  indexed?: boolean;
  chain_id?: number;
  bills_indexed?: number;
  bills_resolved?: number;
  seat_grants?: number;
  settlements?: number;
  verifications?: number;
  note?: string;
};
type Feed = {
  bill?: string;
  total_settlements?: number;
  total_events?: number;
  settlements?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  indexed?: boolean;
};
type Grants = { grants?: Record<string, { verified_at?: number }> };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

const fmtUSDC = (units: unknown): string => {
  const n = Number(units);
  return Number.isFinite(n) ? `${(n / 1e6).toFixed(6)} USDC` : "—";
};
const short = (v: unknown): string => {
  const s = String(v ?? "");
  return s.length > 16 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s || "—";
};
// SR-003 precedence (golden contract in src/app/settlements):
// refunded > executed > fully_confirmed > initiated.
const deriveStatus = (r: Record<string, unknown>): string => {
  if (Number(r.refunded ?? 0) > 0) return "refunded";
  if (r.tx_hash) return "executed";
  if (r.fully_confirmed_at) return "fully_confirmed";
  return "initiated";
};

const Chip = ({ label, value }: { label: string; value: string }) => (
  <span className="rounded-full border px-3 py-1">
    {label}: <strong>{value}</strong>
  </span>
);

export const LiveExplorer = () => {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [bill, setBill] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [seatCount, setSeatCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/live-status")
      .then((r) => r.json())
      .then((b: LiveStatus) => {
        if (alive) setStatus(b);
      })
      .catch(() => {
        if (alive) setStatus({ indexed: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const lookup = useCallback(async (addr: string) => {
    const a = addr.toLowerCase();
    if (!ADDR_RE.test(a)) {
      setError("Bill address must be 0x + 40 hex characters.");
      setFeed(null);
      setSeatCount(null);
      return;
    }
    setError("");
    setPending(true);
    try {
      const [f, g] = (await Promise.all([
        fetch(`/api/settlements?bill=${a}&page=1`).then((r) => r.json()),
        fetch(`/api/seat-grants?bill=${a}`).then((r) => r.json()),
      ])) as [Feed, Grants];
      setFeed(f);
      setSeatCount(Object.keys(g.grants ?? {}).length);
    } catch {
      setError("Indexer unavailable — try again shortly.");
    } finally {
      setPending(false);
    }
  }, []);

  const rows = feed?.settlements ?? [];
  const events = feed?.events ?? [];
  const indexerState =
    status === null ? "…" : status.indexed ? "live" : "offline";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="grid gap-1">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
          TandaBill · read-only live explorer
        </p>
        <h1
          className="font-semibold"
          style={{ fontSize: "clamp(1.5rem, 6vw, 2.1rem)", lineHeight: 1.15 }}
        >
          Funded means funded. Watch it happen.
        </h1>
        <p className="text-sm opacity-85">
          Live Sepolia (4801) state, straight from the escrow indexer. No
          wallet, no login — receipts only.
        </p>
      </header>

      <section
        aria-label="Indexer status"
        className="flex flex-wrap gap-2 text-xs"
      >
        <Chip label="indexer" value={indexerState} />
        <Chip
          label="chain"
          value={status?.chain_id === undefined ? "—" : String(status.chain_id)}
        />
        <Chip
          label="bills indexed"
          value={
            status?.bills_indexed === undefined
              ? "—"
              : String(status.bills_indexed)
          }
        />
        <Chip
          label="bills resolved"
          value={
            status?.bills_resolved === undefined
              ? "—"
              : String(status.bills_resolved)
          }
        />
        <Chip
          label="settlements"
          value={
            status?.settlements === undefined ? "—" : String(status.settlements)
          }
        />
        <Chip
          label="seat grants"
          value={
            status?.seat_grants === undefined ? "—" : String(status.seat_grants)
          }
        />
        <Chip
          label="verifications"
          value={
            status?.verifications === undefined
              ? "—"
              : String(status.verifications)
          }
        />
      </section>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(bill);
        }}
      >
        <input
          aria-label="Bill address"
          value={bill}
          onChange={(e) => setBill(e.target.value)}
          placeholder="0x… bill contract address"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Loading…" : "Look up bill"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {feed && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">
            Settlements for {short(feed.bill)}
          </h2>
          <p className="text-xs opacity-60">
            {feed.total_settlements ?? rows.length} settlement(s) ·{" "}
            {feed.total_events ?? events.length} lifecycle event(s)
            {seatCount !== null && ` · ${seatCount} verified seat(s)`}
          </p>
          {rows.length === 0 && (
            <p className="text-sm opacity-85">
              No settlements recorded for this bill yet — the ledger stays empty
              until funds move.
            </p>
          )}
          {rows.map((r, i) => (
            <article
              key={String(r.settlement_id ?? i)}
              className="grid gap-1 rounded-xl border p-4 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">
                  Settlement {String(r.settlement_id ?? i)}
                </p>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold">
                  {deriveStatus(r)}
                </span>
              </div>
              <p className="tabular-nums">
                Total escrowed: {fmtUSDC(r.total_amount)}
              </p>
              {r.tx_hash ? <p>Execute tx: {String(r.tx_hash)}</p> : null}
              {r.claimed_count !== undefined && (
                <p className="tabular-nums">
                  Claimed: {String(r.claimed_count)} seat(s) ·{" "}
                  {fmtUSDC(r.claimed_amount)}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {events.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-lg font-semibold">Bill lifecycle readback</h2>
          <ol className="grid gap-1 text-xs">
            {events.map((ev, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span className="tabular-nums opacity-60">#{i + 1}</span>
                <span className="font-semibold">{String(ev.event)}</span>
                <span className="tabular-nums opacity-70">
                  block {String(ev.block)}
                  {ev.seat_id != null ? ` · seat ${String(ev.seat_id)}` : ""}
                  {ev.amount != null ? ` · ${fmtUSDC(ev.amount)}` : ""} · tx{" "}
                  {short(ev.tx_hash)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* DEF-4 [t_1d9b5038]: World mini-app rule — no footer element; the
          read-only disclaimer lives inline at the end of the page flow. */}
      <p className="mt-auto text-xs opacity-50">
        Public read-only view — nothing here can move funds.
      </p>
    </main>
  );
};
