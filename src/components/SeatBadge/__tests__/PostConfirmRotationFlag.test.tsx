// @vitest-environment jsdom
// P0.3 C2 ruling addendum (t_96389deb): the badge strip MUST surface the amber
// "post-confirm rotation" anomaly chip, distinct from the verification states.
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PostConfirmRotationFlag } from '@/components/SeatBadge';

afterEach(cleanup);

describe('PostConfirmRotationFlag - anomaly chip contract', () => {
  it('renders the exact ruling text with its own testid', () => {
    render(<PostConfirmRotationFlag />);
    const chip = screen.getByTestId('seat-anomaly');
    expect(chip).toHaveTextContent('⚠ post-confirm rotation');
  });

  it('carries the a11y contract (role=img + aria-label) for screen readers', () => {
    render(<PostConfirmRotationFlag />);
    const chip = screen.getByTestId('seat-anomaly');
    expect(chip).toHaveAttribute('role', 'img');
    expect((chip.getAttribute('aria-label') ?? '').toLowerCase()).toContain('post-confirm rotation');
  });

  it('tooltip states the amended canonical invariant', () => {
    render(<PostConfirmRotationFlag />);
    const title = screen.getByTestId('seat-anomaly').getAttribute('title') ?? '';
    expect(title).toContain('payout still follows the wallet that confirmed');
    expect(title).toContain('execute window elapsed');
  });

  it('amber family: visually distinct from emerald/rose/slate verification badges', () => {
    render(<PostConfirmRotationFlag />);
    expect(screen.getByTestId('seat-anomaly').className).toContain('amber');
  });
});
