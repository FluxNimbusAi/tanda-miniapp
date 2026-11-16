import { auth } from '@/auth';

// W10 slice 2 — server-side notification dispatcher (P1.1 trigger engine leg).
// Holds the Developer Portal API key server-side ONLY (never shipped to client).
// Upstream: POST https://developer.worldcoin.org/api/v2/minikit/send-notification
// (docs.world.org /mini-apps/commands/how-to-send-notifications.md, byte-verified
// 2026-11-16). Requires: portal Advanced-setting grant + user MiniKit permission
// (see NotificationConsent) — unverified apps are capped at 40 notif / 4 h.
//
// Callers: in-app flows (session-authed) or the indexer/cron job (internal key).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM =
  'https://developer.worldcoin.org/api/v2/minikit/send-notification';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const MAX_WALLETS = 200; // conservative; portal form allows 1000 — start tight, 40/4h cap governs anyway

type Localisation = { language: string; title: string; message: string };

interface NotifyBody {
  wallet_addresses: string[];
  localisations: Localisation[];
  mini_app_path?: string;
  idempotency_key?: string;
}

function bad(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

async function authorize(req: Request): Promise<'session' | 'internal' | null> {
  const internalKey = process.env.NOTIFY_INTERNAL_KEY;
  const bearer = req.headers.get('authorization') ?? '';
  if (internalKey && bearer === `Bearer ${internalKey}`) return 'internal';
  try {
    const session = await auth();
    if (session?.user?.walletAddress) return 'session';
  } catch {
    /* fall through */
  }
  return null;
}

// In-memory dedupe for idempotency keys (dev-lane; DB-backed table at scale).
const seen = new Map<string, number>();
const DEDUP_TTL_MS = 1000 * 60 * 60 * 24;
function alreadySeen(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of seen) if (now - ts > DEDUP_TTL_MS) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await authorize(req))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.MINIKIT_API_KEY;
  const appId = process.env.MINIKIT_APP_ID ?? process.env.NEXT_PUBLIC_APP_ID;
  if (!apiKey || !appId) {
    return Response.json(
      { ok: false, error: 'server not configured (MINIKIT_API_KEY / MINIKIT_APP_ID)' },
      { status: 501 },
    );
  }

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return bad('invalid JSON');
  }

  if (
    !Array.isArray(body.wallet_addresses) ||
    body.wallet_addresses.length === 0 ||
    body.wallet_addresses.length > MAX_WALLETS ||
    !body.wallet_addresses.every((w) => typeof w === 'string' && ADDRESS_RE.test(w))
  ) {
    return bad(`wallet_addresses: 1..${MAX_WALLETS} unique 0x addresses required`);
  }
  const wallets = Array.from(new Set(body.wallet_addresses));

  if (
    !Array.isArray(body.localisations) ||
    body.localisations.length === 0 ||
    body.localisations.some(
      (l) =>
        !l ||
        typeof l.language !== 'string' ||
        !LANG_RE.test(l.language) ||
        typeof l.title !== 'string' ||
        l.title.length === 0 ||
        l.title.length > 72 ||
        typeof l.message !== 'string' ||
        l.message.length === 0 ||
        l.message.length > 280,
    )
  ) {
    return bad('localisations: [{language: en…, title ≤72, message ≤280}] required');
  }

  if (body.idempotency_key && alreadySeen(body.idempotency_key)) {
    return Response.json({ ok: true, deduped: true });
  }

  const miniAppPath =
    body.mini_app_path ?? `worldapp://mini-app?app_id=${appId}&path=/home`;
  if (typeof miniAppPath !== 'string' || !miniAppPath.startsWith('worldapp://')) {
    return bad('mini_app_path must be a worldapp:// deep link');
  }

  // Network egress note: this host blocks outbound TLS to developer.worldcoin.org
  // (verified 2026-11-16); Vercel/serverless egress reaches it fine. Fail clean.
  let upstream: Response | null = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 9000);
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: appId,
        wallet_addresses: wallets,
        localisations: body.localisations,
        mini_app_path: miniAppPath,
      }),
    });
    clearTimeout(timer);
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return Response.json(
      { ok: false, error: aborted ? 'upstream timeout' : 'upstream unreachable' },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
