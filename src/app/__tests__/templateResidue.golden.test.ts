// W2.5-3 (t_14b21fee) TEMPLATE-RESIDUE PURGE GATE (Harley OPP-001;
// review-critical for the World App store). Static source contract:
//   1. NO shipped code (non-test file) may reference the demo action
//      'test-action' or MiniKit.getUserByUsername('alex').
//   2. The app home renders no demo widgets: no <Verify action="test-action"
//      />, no <Pay />, no <Transaction />.
//   3. Pay/ is DELETED. W26-FIX (CoS dual-preservation ruling on PR #26):
//      Transaction/index.tsx is RETAINED — deleting it wholesale would
//      revert the landed #28 useUserOpStatus wiring (OPP-003 eternal-pending
//      contract) — but only in purged form: no USDC transfer-to-'alex' demo,
//      never rendered by any shipped page. The retention + wiring is pinned
//      positively below, not weakened.
// Test files may keep 'test-action' only as byte-pin fixtures of the frozen
// rp-signature rejection (PR #14) and the seatJoin golden wire pins.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      yield* walk(p);
    } else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !p.includes('__tests__') &&
      !/\.test\./.test(e.name)
    ) {
      yield p;
    }
  }
}

const SRC = path.join(process.cwd(), 'src');

describe('OPP-001 template-residue purge', () => {
  const shipped = [...walk(SRC)];

  it('scanned a meaningful set of source files', () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  it('no shipped source file mentions the demo action test-action', () => {
    const offenders = shipped.filter((f) =>
      readFileSync(f, 'utf8').includes('test-action'),
    );
    expect(offenders).toEqual([]);
  });

  it("no shipped source file pays the template user 'alex'", () => {
    const offenders = shipped.filter((f) =>
      /getUserByUsername\(\s*[\'\"` ]alex/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('app home renders only the product lane (no Verify/Pay/Transaction demo widgets)', () => {
    const home = readFileSync(
      path.join(SRC, 'app', '(protected)', 'home', 'page.tsx'),
      'utf8',
    );
    expect(home).not.toContain('<Verify');
    expect(home).not.toContain('<Pay');
    expect(home).not.toContain('<Transaction');
    expect(home).not.toContain("action=\"test-action\"");
  });

  it('Pay template component is deleted from the repo', () => {
    expect(existsSync(path.join(SRC, 'components', 'Pay'))).toBe(false);
  });

  // W26-FIX (CoS dual-preservation ruling): the fold must NOT show any
  // '-useUserOpStatus' deletion line. Transaction/index.tsx survives with
  // the landed #28 wiring byte-pinned, and with the demo USDC transfer to
  // the template username purged inside it.
  it('Transaction survivor keeps the #28 lifecycle wiring byte-pinned', () => {
    const txPath = path.join(SRC, 'components', 'Transaction', 'index.tsx');
    expect(existsSync(txPath)).toBe(true);
    const tx = readFileSync(txPath, 'utf8');
    expect(tx).toContain(
      "import { stageCaption, stuckMessage } from '@/lib/userOpStatus';",
    );
    expect(tx).toContain(
      "import { useUserOpStatus } from '@/lib/useUserOpStatus';",
    );
    expect(tx).toContain(
      'const lifecycle = useUserOpStatus({ indexStatusPath: null });',
    );
    expect(tx).toContain('lifecycle.track(result.data.userOpHash);');
  });

  it('Transaction survivor is stripped of the demo transfer residue', () => {
    const tx = readFileSync(
      path.join(SRC, 'components', 'Transaction', 'index.tsx'),
      'utf8',
    );
    expect(tx).not.toContain('onClickTransferToken');
    expect(tx).not.toContain('getUserByUsername');
    expect(tx).not.toMatch(/['"`]alex['"`]/);
  });

  it('landing route is the dual-mode gate (product first, no bare wall)', () => {
    const page = readFileSync(path.join(SRC, 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('ModeGate');
  });
});
