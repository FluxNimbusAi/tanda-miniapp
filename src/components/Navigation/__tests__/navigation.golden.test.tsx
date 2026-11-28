// @vitest-environment jsdom
// APP-1 (t_f16cf60b): the bottom tab bar IS the application shell — four
// routes, New lands the create intent, active state derives from path+query.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

const H = vi.hoisted(() => ({ path: '/home', query: '' as string, pushed: '' as string }));

vi.mock('next/navigation', () => ({
  usePathname: () => H.path,
  useSearchParams: () => new URLSearchParams(H.query),
  useRouter: () => ({ push: (u: string) => { H.pushed = u; } }),
}));
vi.mock('@worldcoin/mini-apps-ui-kit-react', () => ({
  Tabs: ({ value, children, onValueChange }: {
    value: string;
    children: React.ReactNode;
    onValueChange: (v: string) => void;
  }) => (
    <div data-testid="tabs" data-value={value}>
      {children}
      <button data-testid="tap-new" onClick={() => onValueChange('new')} />
    </div>
  ),
  TabItem: ({ label }: { label: string }) => <span>{label}</span>,
}));

import { Navigation } from '@/components/Navigation';

describe('Navigation shell (APP-1)', () => {
  afterEach(cleanup);
  beforeEach(() => { H.path = '/home'; H.query = ''; H.pushed = ''; });
  it('renders four tabs: Home, New, Explorer, Profile', () => {
    render(<Navigation />);
    for (const label of ['Home', 'New', 'Explorer', 'Profile'])
      expect(screen.getByText(label)).toBeInTheDocument();
  });
  it('New tab pushes the create-intent route', () => {
    render(<Navigation />);
    fireEvent.click(screen.getByTestId('tap-new'));
    expect(H.pushed).toBe('/home?intent=create');
  });
  it('intent=create highlights New, not Home', () => {
    H.path = '/home'; H.query = 'intent=create';
    render(<Navigation />);
    expect(screen.getByTestId('tabs').getAttribute('data-value')).toBe('new');
  });
  it('plain /home keeps Home active (no regression)', () => {
    H.path = '/home'; H.query = '';
    render(<Navigation />);
    expect(screen.getByTestId('tabs').getAttribute('data-value')).toBe('home');
  });
});
