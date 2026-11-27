// @vitest-environment jsdom
// BS-4.1 / UX3-#9 EMPTY-STATE GOLDEN. Contract from
// courier/UX3_SPEC_BS23_20261124.md (sha256-LF caa9d521…34649):
//  G1 exact copy (§4b) incl. headline/body/subnote + CTA labels
//  G2 forbidden strings absent from every rendered string (§4b, M5 honesty)
//  G3 example-circle fixture = "Sushi Night — 4 of 4 confirmed — $60.00 each",
//     tap-to-toggle, statically labelled, never auto-shown (§4c)
//  G4 explainer opens in place, 3 steps, no external links (§4a/4e)
//  G4b funnel rule: zero github.com hrefs anywhere in the empty state (§4e)
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { EmptyState } from '@/components/EmptyState';
import { EMPTY_STATE_COPY, FORBIDDEN_STRINGS } from '@/lib/emptyState';

const C = EMPTY_STATE_COPY;

afterEach(cleanup);

function renderState() {
  const onCreate = () => {};
  render(<EmptyState onCreate={onCreate} />);
}

describe('EmptyState — UX3-#9 spec pins', () => {
  it('G1 renders the exact §4b copy', () => {
    renderState();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText(C.headline)).toBeInTheDocument();
    expect(screen.getByText(C.body)).toBeInTheDocument();
    expect(screen.getByText(C.subnote)).toBeInTheDocument();
    expect(screen.getByTestId('empty-cta-create')).toHaveTextContent('Create a bill');
    // byte-pins, not just presence — copy drift must fail loudly
    expect(C.headline).toBe('Split the tab without the awkward.');
    expect(C.subnote).toBe(
      'Round-trip in two steps: fund your share, then confirm. No one can pull funds until the group executes.',
    );
  });

  it('G2 no forbidden string appears anywhere in the rendered tree', () => {
    renderState();
    fireEvent.click(screen.getByTestId('empty-cta-explain'));
    fireEvent.click(screen.getByTestId('empty-preview-chip'));
    const text = screen.getByTestId('empty-state').textContent ?? '';
    for (const bad of FORBIDDEN_STRINGS) {
      expect(text.toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });

  it('G3 example circle: hidden until tapped, static fixture, relabeled', () => {
    renderState();
    expect(screen.queryByTestId('empty-example-circle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('empty-preview-chip'));
    const ex = screen.getByTestId('empty-example-circle');
    expect(ex).toHaveTextContent('Sushi Night');
    expect(ex).toHaveTextContent('4 of 4 confirmed — $60.00 each');
    expect(ex).toHaveTextContent('Example only');
    fireEvent.click(screen.getByTestId('empty-preview-chip'));
    expect(screen.queryByTestId('empty-example-circle')).not.toBeInTheDocument();
  });

  it('G4 explainer renders 3 steps in place; G4b zero external hrefs (§4e)', () => {
    renderState();
    fireEvent.click(screen.getByTestId('empty-cta-explain'));
    const steps = screen.getByTestId('empty-explainer');
    expect(steps.querySelectorAll('li')).toHaveLength(3);
    expect(steps.textContent).toContain('Create');
    expect(steps.textContent).toContain('Fund');
    expect(steps.textContent).toContain('Confirm');
    const roots = screen.getByTestId('empty-state');
    for (const a of roots.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/github\.com|https?:/);
    }
  });

  // BS-5.1a NEGATIVE-TEST LAW (Flux ruling 57194): a grep-golden that cannot
  // fail on injection is decoration. N0 proves the matcher is non-vacuous by
  // running it against a deliberately poisoned copy object; N1 asserts the
  // SHIPPED copy passes the same matcher. Pair is permanent — future copy
  // edits trip N1 only if they actually introduce forbidden language.
  const violationsOf = (copy: Record<string, unknown>): string[] => {
    const hay = JSON.stringify(copy).toLowerCase();
    return FORBIDDEN_STRINGS.filter((f) => hay.includes(f.toLowerCase()));
  };

  it('N0 matcher is non-vacuous: injected forbidden string IS detected', () => {
    const poisoned = {
      ...C,
      body: 'Your enforceable debt settles on-chain — nullifier burned.',
    };
    const v = violationsOf(poisoned);
    expect(v).toContain('enforceable debt');
    expect(v).toContain('nullifier');
    expect(v).toHaveLength(2);
  });

  it('N1 shipped copy passes the same matcher (clean)', () => {
    expect(violationsOf(C)).toEqual([]);
  });
});
