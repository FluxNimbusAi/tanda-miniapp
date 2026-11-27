// @vitest-environment jsdom
// P0.3 SeatBadge render tests (t_44ae186c): the badge must render correctly
// and distinctly for verified / unverified / unknown, purely from the exposed
// verification state — plus the legacy boolean|null flag bridge.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SeatBadge, SeatBadgeFromFlag } from '@/components/SeatBadge';

afterEach(cleanup);

const STATES = {
  verified: '⬡ World ID verified',
  unverified: '✕ Not verified',
  unknown: '? Verification unavailable',
} as const;

describe('SeatBadge — renders from the exposed verification state', () => {
  for (const [state, label] of Object.entries(STATES) as [keyof typeof STATES, string][]) {
    it(`renders the ${state} chip with correct text, state attr and a11y`, () => {
      render(<SeatBadge status={state} />);
      const badge = screen.getByTestId('seat-badge');
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute('data-state', state);
      expect(badge).toHaveAttribute('role', 'img');
      expect(badge).toHaveAttribute('aria-label', `World ID ${state}`);
      // distinct human explanation per state (tooltip carries the meaning)
      expect(badge.getAttribute('title')).toBeTruthy();
    });
  }

  it('the three states are visually distinct (class + glyph + title all differ)', () => {
    const rendered = (Object.keys(STATES) as (keyof typeof STATES)[]).map((s) => {
      const { unmount } = render(<SeatBadge status={s} />);
      const el = screen.getByTestId('seat-badge');
      const snap = { cls: el.className, title: el.title, text: el.textContent };
      unmount();
      return snap;
    });
    const [v, u, k] = rendered;
    expect(v.cls).not.toBe(u.cls);
    expect(v.cls).not.toBe(k.cls);
    expect(u.cls).not.toBe(k.cls);
    expect(v.text).not.toBe(u.text);
    expect(new Set(rendered.map((r) => r.title)).size).toBe(3);
  });

  it('verified vs unverified use different palette families (emerald vs rose)', () => {
    render(<SeatBadge status="verified" />);
    expect(screen.getByTestId('seat-badge').className).toContain('emerald');
    cleanup();
    render(<SeatBadge status="unverified" />);
    expect(screen.getByTestId('seat-badge').className).toContain('rose');
  });
});

describe('SeatBadgeFromFlag — legacy boolean|null bridge into the UI', () => {
  it('true -> verified chip', () => {
    render(<SeatBadgeFromFlag verified={true} />);
    expect(screen.getByTestId('seat-badge')).toHaveAttribute('data-state', 'verified');
  });

  it('false -> unverified chip', () => {
    render(<SeatBadgeFromFlag verified={false} />);
    expect(screen.getByTestId('seat-badge')).toHaveAttribute('data-state', 'unverified');
  });

  it('null (missing data) -> neutral unknown chip, never a crash or blank', () => {
    render(<SeatBadgeFromFlag verified={null} />);
    expect(screen.getByTestId('seat-badge')).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByTestId('seat-badge')).toHaveTextContent('Verification unavailable');
  });

  it('undefined -> unknown chip as well', () => {
    render(<SeatBadgeFromFlag verified={undefined} />);
    expect(screen.getByTestId('seat-badge')).toHaveAttribute('data-state', 'unknown');
  });
});
