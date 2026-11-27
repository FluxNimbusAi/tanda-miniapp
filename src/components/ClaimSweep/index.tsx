"use client";

// KAIZEN-5 (t_86b44100): the pull-claim sweep surface. Multi-bill unclaimed
// view (H4 accrual framing) with per-bill checkboxes (H5 selection), mounted
// on (protected)/home — NOT on /bill pages (KAIZEN-1/2 collision law).
// Feed = GET /api/claims?address=<session wallet>; empty/degraded feed renders
// NOTHING (fail-soft, the home never blanks or nags on an offline index).
//
// Phantom-class preview-before-sign discipline (VISUAL-B): the batched userOp
// is only built and sent after an explicit ConfirmPreview. The sweep is ONE
// signature over N factory.callBill(claimSettlement) wrappers (MiniKit takes a
// transactions array; clones are never targets — audit correction #1).
import { MiniKit } from "@worldcoin/minikit-js";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { TANDA } from "@/config/tanda";
import {
  ConfirmPreview,
  type IntentSummary,
} from "@/components/ConfirmPreview";
import { useUserOpStatus } from "@/lib/useUserOpStatus";
import {
  accrualCopy,
  buildSweepPlan,
  formatUSDC,
  groupByBill,
  selectedRows,
  sumUnclaimed,
  sweepCtaCopy,
  toggleBillSelection,
  type ClaimRow,
} from "@/lib/claimSweep";
import type { Address } from "viem";

type FeedClaim = {
  bill: string;
  settlement_id: number;
  unclaimed_units: number;
  settled_at: number | null;
};
type FeedBody = { claims?: FeedClaim[]; indexed?: boolean };

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;

export const ClaimSweep = () => {
  const session = useSession();
  const wallet = session.data?.user?.walletAddress?.toLowerCase() ?? "";
  const lifecycle = useUserOpStatus();

  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    summary: IntentSummary;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // Feed fetch: session-gated; degraded payloads (indexed:false / missing
  // claims) simply produce an empty list -> component hides itself.
  useEffect(() => {
    if (!wallet) {
      setRows([]);
      return;
    }
    let dead = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/claims?address=${encodeURIComponent(wallet)}`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const j = (await r.json()) as FeedBody;
        if (dead) return;
        const mapped: ClaimRow[] = (j.claims ?? []).map((c) => ({
          bill: c.bill as Address,
          settlementId: c.settlement_id,
          unclaimedUnits: BigInt(c.unclaimed_units),
          settledAt: c.settled_at,
        }));
        setRows(mapped);
        // H5 default: everything selected (sweep-first UX); the user prunes.
        setSelected(groupByBill(mapped).map((g) => g.key));
      } catch {
        /* offline index = invisible panel, never an error state */
      }
    })();
    return () => {
      dead = true;
    };
  }, [wallet]);

  const groups = useMemo(() => groupByBill(rows), [rows]);
  const chosen = useMemo(
    () => selectedRows(rows, selected),
    [rows, selected],
  );
  const pool = useMemo(() => sumUnclaimed(chosen), [chosen]);
  const totalPool = useMemo(() => sumUnclaimed(rows), [rows]);

  if (groups.length === 0) return null;

  const onSweep = () => {
    setStatus("");
    const plan = buildSweepPlan(chosen, TANDA.factory);
    if (plan.length === 0) return; // never invite an empty userOp
    setPreview({
      summary: {
        fn: "claimSettlement",
        amount: formatUSDC(pool),
        // The factory is the single write target; N wrapped calls ride one
        // userOp — the summary names it honestly (bills stay behind callBill).
        target: TANDA.factory,
      },
    });
  };

  const onConfirmSweep = async () => {
    const plan = buildSweepPlan(chosen, TANDA.factory);
    setPreview(null);
    if (plan.length === 0) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await MiniKit.sendTransaction({
        chainId: TANDA.chainId,
        transactions: plan.map((p) => ({ to: p.to, data: p.data })),
      });
      if (!result.data?.userOpHash) throw new Error("No userOpHash returned");
      // No bill scope: a sweep spans many bills, so the honest terminal is
      // the by-userop lane (same as createBill).
      lifecycle.track(result.data.userOpHash);
      setStatus(`Sweep submitted (${plan.length} claim${plan.length === 1 ? "" : "s"}).`);
    } catch (err) {
      setStatus(`Sweep failed: ${(err as Error).message.slice(0, 100)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="claim-sweep-heading"
      data-testid="claim-sweep"
      className="w-full max-w-md grid gap-3 rounded-[14px] border-l-[3px] border-l-[#3ec8ff] bg-[#171a25] p-4 text-[#e8eaf2]"
      style={{ border: "1px solid rgba(255,255,255,.06)", borderLeft: "3px solid #3ec8ff" }}
    >
      <p
        id="claim-sweep-heading"
        className="text-xs font-bold uppercase tracking-wider opacity-70"
      >
        Unclaimed payouts
      </p>
      <p className="text-sm font-semibold">{accrualCopy(groups.length, totalPool)}</p>

      <ul className="grid gap-2" data-testid="claim-bill-list">
        {groups.map((g) => (
          <li key={g.key}>
            <label className="flex items-center gap-2 text-sm" data-testid={`claim-bill-${g.key}`}>
              <input
                type="checkbox"
                checked={selected.includes(g.key)}
                onChange={() => setSelected((s) => toggleBillSelection(s, g.key))}
              />
              <span className="break-all">{short(g.bill)}</span>
              <span className="ml-auto font-bold text-[#3ec8ff]" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatUSDC(g.poolUnits)} USDC
              </span>
              <span className="text-xs opacity-60">
                {g.rows.length} settlement{g.rows.length === 1 ? "" : "s"}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        data-testid="claim-sweep-cta"
        onClick={onSweep}
        disabled={busy || pool <= BigInt(0)}
        className="rounded-[14px] bg-[#ff3e7f] px-5 py-2.5 text-sm font-bold text-[#0a0b10] disabled:opacity-40"
      >
        {sweepCtaCopy(selected.length ? groups.filter((g) => selected.includes(g.key)).length : 0, pool)}
      </button>

      {preview && (
        <ConfirmPreview
          summary={preview.summary}
          onConfirm={onConfirmSweep}
          onCancel={() => setPreview(null)}
        />
      )}
      {status && (
        <p data-testid="claim-sweep-status" className="text-xs opacity-80">
          {status}
        </p>
      )}
    </section>
  );
};
