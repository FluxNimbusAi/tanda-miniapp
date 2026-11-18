// P1.4 — accessible settlement vector table for the Track A confirm screen.
// Pure presentational component: every string comes from the builder, so the
// DOM is deterministic for a given vector. Captioned table + scoped headers +
// per-row aria-describedby onto the "Why" cell + a full sr-only text rendering
// (the same bytes the golden test snapshots) for screen readers.
import {
  formatUnits6,
  renderSettlementVectorText,
  type SettlementVector,
} from "@/lib/settlementVector";

const short = (w: string): string => `${w.slice(0, 6)}…${w.slice(-4)}`;

export const SettlementVectorTable = ({
  vector,
}: {
  vector: SettlementVector;
}) => {
  const n = vector.components.length;
  return (
    <section
      aria-labelledby="sv-heading"
      className="grid gap-1 border-t border-dashed pt-2"
    >
      <p id="sv-heading" className="text-xs font-semibold opacity-80">
        Settlement #{vector.settlementId.toString()} — who receives what
      </p>
      <table className="w-full text-xs">
        <caption className="text-left opacity-70">
          Payout vector of {n} seat{n === 1 ? "" : "s"}. Total{" "}
          {vector.totalAmount.toString()} units (
          {formatUnits6(vector.totalAmount)} USDC, {vector.scale} decimals)
          split equally across the settlement roster — leftover units go to the
          lowest ranks.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              Seat
            </th>
            <th scope="col" className="text-left">
              Wallet
            </th>
            <th scope="col" className="text-left">
              Payout (USDC)
            </th>
            <th scope="col" className="text-left">
              Why
            </th>
          </tr>
        </thead>
        <tbody>
          {n === 0 && (
            <tr>
              <td colSpan={4} className="opacity-60">
                No expected seats — nothing to settle.
              </td>
            </tr>
          )}
          {vector.components.map((c) => (
            <tr key={c.seatId}>
              <th
                scope="row"
                className="text-left"
                aria-describedby={`sv-explain-${c.seatId}`}
              >
                #{c.seatId}
              </th>
              <td
                className="break-all"
                aria-describedby={`sv-explain-${c.seatId}`}
              >
                {short(c.wallet)}
              </td>
              <td aria-describedby={`sv-explain-${c.seatId}`}>
                {formatUnits6(c.payout)}
              </td>
              <td id={`sv-explain-${c.seatId}`} className="opacity-70">
                rank {c.rank}: {formatUnits6(c.derivation.base)} +{" "}
                {c.derivation.getsRemainderUnit ? "1" : "0"} leftover unit
                {c.derivation.getsRemainderUnit ? "" : "s"}
                <span className="sr-only">. {c.explanation}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {vector.expenseTrace.length > 0 && (
        <ul className="text-xs opacity-70">
          {vector.expenseTrace.map((e) => (
            <li key={e.id}>
              expense #{e.id}: {formatUnits6(e.amount)} USDC paid by{" "}
              {short(e.paidBy)}
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only">{renderSettlementVectorText(vector)}</p>
    </section>
  );
};
