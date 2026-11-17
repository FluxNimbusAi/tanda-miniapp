// P0.3 seat-level World ID verification badge (t_d1c1cf68).
// One visual per state; the three states are distinct by color, glyph and
// text so they stay separable monochrome and for screen readers.
import { flagToVerification, type SeatVerification } from '@/lib/seatVerification';

const STYLE: Record<
  SeatVerification,
  { label: string; title: string; className: string }
> = {
  verified: {
    label: '⬡ World ID verified',
    title: 'This seat holds a confirmed World ID human verification',
    className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600',
  },
  unverified: {
    label: '✕ Not verified',
    title: 'Verification index is live and this seat has NO confirmed World ID',
    className: 'border-rose-500/40 bg-rose-500/15 text-rose-600',
  },
  unknown: {
    label: '? Verification unavailable',
    title: 'Badge feed missing or index not built — verification state unknown',
    className: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  },
};

/** Pure seat-level badge: renders ONLY from the exposed verification state. */
export const SeatBadge = ({ status }: { status: SeatVerification }) => {
  const s = STYLE[status];
  return (
    <span
      data-testid="seat-badge"
      data-state={status}
      role="img"
      aria-label={`World ID ${status}`}
      title={s.title}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-none ${s.className}`}
    >
      {s.label}
    </span>
  );
};

/** Convenience for callers still holding the legacy boolean|null flag. */
export const SeatBadgeFromFlag = ({
  verified,
}: {
  verified: boolean | null | undefined;
}) => <SeatBadge status={flagToVerification(verified)} />;
