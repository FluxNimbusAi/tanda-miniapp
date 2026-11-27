// W2.5-4 (t_edd4a5e9) — World Usernames client. READ-ONLY resolution lane:
// live API surface verified 2026-11-19 against
// https://usernames.worldcoin.org/docs (OpenAPI 3.1 "World App Username API"
// v0.1.0). Preflight probe from a foreign Origin returns
// `access-control-allow-origin: *`, so the World App webview may call the
// service directly — no server proxy. Write paths (register/rename/update)
// are deliberately NOT referenced here (UI-only + read APIs per charter).
//
// Doctrine (mirrors loadBadges in TandaBill): resolution can NEVER blank or
// crash the roster. Every entry point is fail-soft at the call site; this
// module throws only the typed UsernameServiceError for callers that choose
// to catch it.
import { getAddress, isAddress, type Address } from 'viem';

export const USERNAME_SERVICE_BASE = 'https://usernames.worldcoin.org';

/** Hard cap on items per /api/v1/query call. The service answers oversized
 *  batches with 422 "too many items" (limit undocumented -> conservative). */
export const QUERY_CHUNK = 20;

/** Module-level TTL cache + in-flight dedupe (rosters re-probe often; the
 *  service mapping is quasi-static). 60 s keeps handle renames fresh enough
 *  for a bill UI while collapsing repeat lookups inside one session. */
const TTL_MS = 60_000;
const cache = new Map<
  string,
  { at: number; value: UsernameRecord | null }
>();
const inflight = new Map<string, Promise<UsernameRecord | null>>();

export type UsernameRecord = {
  username: string;
  /** EIP-55 checksummed wallet the handle resolves to (service guarantees
   *  checksummed output; we re-checksum defensively). */
  address: Address;
  profilePictureUrl?: string;
};

export class UsernameServiceError extends Error {
  constructor(
    readonly code: 'timeout' | 'http' | 'network' | 'shape',
    message: string,
  ) {
    super(message);
    this.name = 'UsernameServiceError';
  }
}

/**
 * ENS-compatible handle validation + normalization. Accepts the user typing
 * "@alice", "alice", or mixed case — the service is case-insensitive; the
 * canonical form is lowercase. Rejects empty, edges/adjacent hyphens, and
 * anything outside [a-z0-9-] (UX guard only; the service remains the truth).
 */
export function normalizeHandle(raw: string): string | null {
  const s = raw.trim().replace(/^@+/, '').toLowerCase();
  if (!/^(?!-)[a-z0-9-]{1,30}(?<!-)$/.test(s) || s.includes('--')) return null;
  return s;
}

/**
 * Classify the comma/space-separated create-bill seat input into addresses,
 * @handles and invalid tokens. Addresses come back EIP-55 checksummed so the
 * wire payload is canonical regardless of how they were pasted.
 */
export function parseSeatTokens(input: string): {
  addresses: Address[];
  handles: string[];
  invalid: string[];
} {
  const addresses: Address[] = [];
  const handles: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const add = (key: string, push: () => void) => {
    if (seen.has(key)) return;
    seen.add(key);
    push();
  };
  for (const tok of input.split(/[\s,]+/).filter(Boolean)) {
    if (isAddress(tok)) {
      const a = getAddress(tok);
      add(a.toLowerCase(), () => addresses.push(a));
      continue;
    }
    const h = normalizeHandle(tok);
    if (h !== null) {
      add(h, () => handles.push(h));
      continue;
    }
    invalid.push(tok);
  }
  return { addresses, handles, invalid };
}

async function serviceFetch(url: string, init?: RequestInit): Promise<Response> {
  // AbortController + timer (not AbortSignal.timeout) — widest webview
  // compatibility inside the World App container.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError')
      throw new UsernameServiceError('timeout', `username lookup timed out: ${url}`);
    throw new UsernameServiceError('network', `username lookup failed: ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Defensive wire -> record parse. Returns null on any shape drift (the
 *  service may add fields; it must not be able to crash us). */
export function toRecord(json: unknown): UsernameRecord | null {
  const r = json as Record<string, unknown> | null;
  if (!r || typeof r.username !== 'string' || !isAddress(String(r.address)))
    return null;
  const rec: UsernameRecord = {
    username: r.username,
    address: getAddress(String(r.address)) as Address,
  };
  if (typeof r.profile_picture_url === 'string')
    rec.profilePictureUrl = r.profile_picture_url;
  return rec;
}

/**
 * Resolve one @handle (or 0x address) to its registered record.
 * GET /api/v1/{name}: 200 -> record, 404 -> null (unknown handle),
 * 301 (recent rename) -> fetch follows to the new record. Cached 60 s and
 * deduped in-flight.
 */
export async function resolveHandle(
  handle: string,
): Promise<UsernameRecord | null> {
  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async (): Promise<UsernameRecord | null> => {
    const res = await serviceFetch(
      `${USERNAME_SERVICE_BASE}/api/v1/${encodeURIComponent(key)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok)
      throw new UsernameServiceError('http', `resolve ${key}: HTTP ${res.status}`);
    return toRecord(await res.json().catch(() => null));
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  // 404s resolve null through this path (negative cache); thrown errors stay
  // uncached so one flaky minute cannot ghost a good handle for a whole TTL.
  const v = await p;
  cache.set(key, { at: Date.now(), value: v });
  return v;
}

async function queryChunk(body: {
  addresses: string[];
  usernames: string[];
}): Promise<UsernameRecord[]> {
  const res = await serviceFetch(
    `${USERNAME_SERVICE_BASE}/api/v1/query`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Byte contract for the batch call (verified against live OpenAPI):
      // {"addresses":[...],"usernames":[...]} — both keys always present.
      body: JSON.stringify({
        addresses: body.addresses,
        usernames: body.usernames,
      }),
    },
  );
  if (!res.ok)
    throw new UsernameServiceError(
      'http',
      `query HTTP ${res.status}: ${res.status === 422 ? 'too many items' : ''}`,
    );
  const arr = await res.json().catch(() => null);
  if (!Array.isArray(arr))
    throw new UsernameServiceError('shape', 'query returned a non-array body');
  return arr.map(toRecord).filter((r): r is UsernameRecord => r !== null);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Batch-resolve seat wallets -> records for the roster "verified humans"
 * display. The service returns ONLY the found subset (live-probed), so
 * callers must treat a missing map key as "no username registered".
 * Keys are lowercased checksummed addresses for stable lookup.
 */
export async function lookupUsernamesForWallets(
  addresses: readonly Address[],
): Promise<Map<string, UsernameRecord>> {
  const map = new Map<string, UsernameRecord>();
  const uniq = [...new Set(addresses.map((a) => getAddress(a).toLowerCase()))];
  const groups = await Promise.all(
    chunk(uniq, QUERY_CHUNK).map((c) =>
      queryChunk({ addresses: c, usernames: [] }),
    ),
  );
  for (const rec of groups.flat()) map.set(rec.address.toLowerCase(), rec);
  return map;
}

/**
 * Batch-resolve @handles -> wallets for the invite/create path
 * ("@handle -> wallet", the core W2.5-4 primitive). Keys are lowercase
 * handles; values carry the checksummed wallet to feed straight into
 * createBill's initial roster.
 */
export async function resolveWalletsForHandles(
  handles: readonly string[],
): Promise<Map<string, UsernameRecord>> {
  const map = new Map<string, UsernameRecord>();
  const uniq = [...new Set(handles.map((h) => h.toLowerCase()))];
  const groups = await Promise.all(
    chunk(uniq, QUERY_CHUNK).map((c) => queryChunk({ addresses: [], usernames: c })),
  );
  for (const rec of groups.flat()) map.set(rec.username.toLowerCase(), rec);
  return map;
}
