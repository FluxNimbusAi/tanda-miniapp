"use client";

/**
 * VISUAL-B (t_d3455bc6) — Phantom-class preview-before-sign panel.
 * Any MiniKit signature in the product lane passes through the sendAction
 * gate in TandaBill; this panel is the ONE surface that summarizes what the
 * user is about to sign. Night Ledger tokens (design/design.css is the
 * single source): surface-2 background, 3px neon-blue left border (.preview
 * class), money figures tabular-nums, blue = signal, pink = the confirm
 * action, max one accent per role. Cancel is deliberately de-emphasized
 * (dim text) so the default path is reading, not clicking.
 */

const VERBS: Record<string, string> = {
  fundEscrow: "Park USDC into the bill's escrow",
  addExpense: "Record an expense on the bill",
  approve: "Allow the bill contract to move your USDC allowance",
  initiateSettlement: "Open a settlement round for this bill",
  confirmSettlement: "Confirm the current settlement payout vector",
  executeSettlement: "Release payouts to every seat",
  refundSettlement: "Refund the escrow back to the payer",
  rotateSeatWallet: "Move your seat to a new wallet",
};

export type IntentSummary = {
  fn: string;
  amount?: string; // human 6-decimal USDC figure when decodable
  target: string; // shortened address
};

export const ConfirmPreview = ({
  summary,
  onConfirm,
  onCancel,
}: {
  summary: IntentSummary;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const verb = VERBS[summary.fn] ?? `Run ${summary.fn} on the bill`;
  return (
    <section
      aria-labelledby="confirm-preview-heading"
      data-testid="confirm-preview"
      className="grid gap-3 rounded-[14px] border-l-[3px] border-l-[#3ec8ff] bg-[#171a25] p-4 text-[#e8eaf2]"
      style={{
        border: "1px solid rgba(255,255,255,.06)",
        borderLeft: "3px solid #3ec8ff",
      }}
    >
      <p
        id="confirm-preview-heading"
        className="text-xs font-bold uppercase tracking-wider opacity-70"
      >
        Review before signing
      </p>
      <p className="text-base font-semibold">{verb}</p>
      {summary.amount !== undefined && (
        <p
          className="text-lg font-extrabold text-[#3ec8ff]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {summary.amount} USDC
        </p>
      )}
      <p className="break-all text-xs opacity-70">
        {`contract ${summary.target.slice(0, 10)}…${summary.target.slice(-6)}`}
      </p>
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          data-testid="confirm-sign"
          onClick={onConfirm}
          className="rounded-[14px] bg-[#ff3e7f] px-5 py-2.5 text-sm font-bold text-[#0a0b10]"
        >
          Confirm &amp; sign
        </button>
        <button
          type="button"
          data-testid="cancel-sign"
          onClick={onCancel}
          className="rounded-[14px] px-4 py-2.5 text-sm font-semibold text-[#8b90a3]"
        >
          Cancel
        </button>
      </div>
    </section>
  );
};
