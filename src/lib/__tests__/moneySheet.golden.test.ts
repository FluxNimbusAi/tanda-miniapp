// APP-2 (t_e723c7f3, owner directive 58131): the NATIVE MONEY SHEET STORY.
// Every money leg — fund, confirm, execute, claim (plus the supporting
// writes) — must reach the user as ONE MiniKit.sendTransaction native sheet,
// so the tx lands in the World App wallet history and gas sponsorship
// applies. That only holds while every write targets a portal Contract
// Entrypoint: the static factory (callBill router) or USDC (approve).
// Clones are NEVER transaction targets — MiniKit fails them with
// invalid_contract, and no unit/tsc/CI run except THIS golden catches it
// outside a real World App session (world-miniapp law: the golden is the
// only enforcement that exists). The registerSeat direct-clone bypass
// found in the APP-2 audit is pinned against regression below.
//
// Two enforcement layers:
//  1. Encoder pins: all nine write verbs via billAction resolve
//     to === FACTORY and the inner clone calldata round-trips.
//  2. Source scan: shipped call sites (TandaBill, ClaimSweep) can only
//     sendAction with an ActionSpec `.to` / TANDA.factory, never a raw
//     bill address, and MiniKit.sendTransaction blocks only ever name
//     sanctioned targets (precedent: templateResidue.golden walk style).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decodeFunctionData,
  encodeFunctionData,
  stringToHex,
  type Abi,
} from 'viem';
import BillABI from '@/abi/TandaBillV2.json';
import FactoryABI from '@/abi/TandaBillFactory.json';
import { billAction, usdcApprove } from '@/lib/billActions';
import type { Address } from 'viem';

const FACTORY = '0xFaC0000000000000000000000000000000000001';
const USDC = '0x5544434300000000000000000000000000000000';
const BILL_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BILL_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NULLIFIER =
  '0x1111111111111111111111111111111111111111111111111111111111111111';

// The full APP-2 leg census, args shaped exactly as the UI sends them.
const LEGS: [string, readonly unknown[]][] = [
  ['fundEscrow', [BigInt(25000000)]],
  ['confirmSettlement', [BigInt(0)]],
  ['executeSettlement', [BigInt(0)]],
  ['claimSettlement', [BigInt(3)]],
  ['initiateSettlement', []],
  ['refundSettlement', [BigInt(0)]],
  ['addExpense', [BigInt(12500000)]],
  ['rotateSeatWallet', [BigInt(1), BILL_B]],
  // signal = canonical UTF-8 string, hex-encoded for the viem bytes param
  // (stringToHex, exactly as shipped — toBytes/Uint8Array throws at encode).
  [
    'registerSeat',
    [
      NULLIFIER,
      BILL_B,
      stringToHex(`${BILL_A.toLowerCase()}:${BILL_B.toLowerCase()}`),
    ],
  ],
];

describe('APP-2 money-sheet encoder pins — every leg targets the factory', () => {
  it('all nine write verbs: to === FACTORY, inner calldata round-trips', () => {
    for (const [fn, args] of LEGS) {
      const a = billAction(BILL_A, FACTORY, fn, args);
      expect(a.label, fn).toBe(fn);
      // THE entrypoint law: static factory, never the clone.
      expect(a.to, `${fn} target`).toBe(FACTORY);
      const outer = decodeFunctionData({
        abi: FactoryABI as unknown as Abi,
        data: a.data,
      });
      expect(outer.functionName, `${fn} outer`).toBe('callBill');
      const [target, inner] = outer.args as [Address, `0x${string}`];
      expect(target.toLowerCase(), `${fn} routed bill`).toBe(BILL_A);
      const dec = decodeFunctionData({
        abi: BillABI as unknown as Abi,
        data: inner,
      });
      expect(dec.functionName, `${fn} inner selector`).toBe(fn);
      // Byte-exactness against an INDEPENDENT re-encode (never reusing the
      // SUT's outer wrapper): inner is the buffer the SUT shipped inside
      // callBill; expected is a fresh encode — same args in, same bytes out.
      expect(inner, `${fn} inner bytes`).toBe(
        encodeFunctionData({
          abi: BillABI as unknown as Abi,
          functionName: fn,
          args: [...args],
        }),
      );
    }
  });

  it('approve is the ONLY direct-token write: to === USDC, spender = clone', () => {
    const ap = usdcApprove(USDC, BILL_A, BigInt(25000000));
    expect(ap.to).toBe(USDC);
    const dec = decodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'approve',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ] as Abi,
      data: ap.data,
    });
    expect(dec.functionName).toBe('approve');
    const [spender, amount] = dec.args as [Address, bigint];
    expect(spender.toLowerCase()).toBe(BILL_A);
    expect(amount).toBe(BigInt(25000000));
  });
});

// ---- source-scan enforcement (shipped call sites) -----------------------

const read = (rel: string[]) =>
  readFileSync(path.join(process.cwd(), 'src', ...rel), 'utf8');

/** Balanced-paren slice from `marker` through its matching close paren. */
function callBlocks(src: string, marker: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf(marker, i)) !== -1) {
    let depth = 0;
    let j = i + marker.length - 1; // at the '('
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

/** Split one call's interior args on TOP-LEVEL commas only. */
function argList(call: string): string[] {
  const inner = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'));
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().replace(/\s+/g, ' '));
}

describe('APP-2 source scan — no shipped write site bypasses the entrypoint gate', () => {
  const TANDABILL = read(['components', 'TandaBill', 'index.tsx']);
  const SWEEP = read(['components', 'ClaimSweep', 'index.tsx']);

  it('no sendAction site ever names a raw bill address as target', () => {
    for (const src of [TANDABILL, SWEEP]) {
      expect(src).not.toMatch(/sendAction\(\s*"[^"]+"\s*,\s*billAddr/);
      expect(src).not.toMatch(/to:\s*billAddr/);
      // The defect shape found in the audit: inline clone encoding shipped
      // straight into a send — banned wholesale inside sendAction args.
      // (No `s` flag: tsconfig target < es2018; [^)] spans newlines anyway.)
      expect(src).not.toMatch(/sendAction\([^)]*encodeFunctionData/);
    }
  });

  it('every sendAction target arg is an ActionSpec .to or TANDA.factory', () => {
    const sites = callBlocks(TANDABILL, 'sendAction(')
      // the definition itself has no string-literal first arg — drop it
      .filter((c) => !c.startsWith('sendAction = '));
    expect(sites.length).toBeGreaterThanOrEqual(8); // full leg census wired
    for (const c of sites) {
      const args = argList(c);
      const target = args[1];
      expect(
        target === 'TANDA.factory' || /\.to$/.test(target),
        `sendAction target: ${target}`,
      ).toBe(true);
    }
  });

  it('MiniKit.sendTransaction blocks only ever name sanctioned targets', () => {
    const ALLOWED = new Set(['TANDA.factory', 'p.to', 'to']);
    for (const src of [TANDABILL, SWEEP]) {
      for (const block of callBlocks(src, 'MiniKit.sendTransaction(')) {
        for (const m of block.matchAll(/\bto:\s*([A-Za-z0-9_.]+)/g)) {
          expect(
            ALLOWED.has(m[1]),
            `unsanctioned sendTransaction target: ${m[1]}`,
          ).toBe(true);
        }
      }
    }
  });

  it('registerSeat is wrapped (audit-defect regression pin)', () => {
    expect(TANDABILL).toMatch(
      /billAction\(\s*billAddr,\s*TANDA\.factory,\s*"registerSeat"/,
    );
  });

  it('the claim sweep builds its plan against TANDA.factory', () => {
    const calls = SWEEP.match(/buildSweepPlan\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) expect(c).toContain('TANDA.factory');
  });

  it('the chained fund lane re-enters sendAction via the wrapped fundEscrow spec', () => {
    // approve mines -> fundEscrow must go through billAction + sendAction,
    // the same sheet path as every other leg (two userOps, one per leg).
    expect(TANDABILL).toMatch(
      /billAction\(\s*billAddr,\s*TANDA\.factory,\s*"fundEscrow"[\s\S]{0,80}sendAction\(\s*"fundEscrow"/,
    );
  });
});
