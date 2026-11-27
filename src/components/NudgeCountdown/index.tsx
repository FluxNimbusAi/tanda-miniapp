// P1.1b render lane (t_p11b_nudge_render) — presentational countdown chip for
// the cadence-nudge landing state on /home. Kept dependency-pure (no MiniKit,
// no viem, no hooks) so it renderToString-goldens in the node test env, the
// same lane shape as SeatBadge/SeatBadgeFromFlag (P0.3).
import { nudgeLabel, type NudgeStatus } from "@/lib/nudgeStatus";

const TONE: Record<NudgeStatus["kind"], string> = {
  "refund-countdown": "border-amber-400/60 text-amber-600",
  "refund-horizon": "border-amber-500 text-amber-700 font-bold",
  "execute-countdown": "border-emerald-400/60 text-emerald-600",
  executable: "border-emerald-500 text-emerald-700 font-bold",
};

export const NudgeCountdown = ({
  status,
  usdc,
}: {
  status: NudgeStatus;
  usdc?: string;
}) => (
  <p
    aria-live="polite"
    className={`rounded-lg border bg-background px-3 py-2 text-xs font-semibold tabular-nums ${TONE[status.kind]}`}
    data-kind={status.kind}
    role="status"
  >
    {nudgeLabel(status, usdc)}
  </p>
);
