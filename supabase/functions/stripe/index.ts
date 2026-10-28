// AkashicSwaps — the `stripe` Edge Function: bundle checkout ($2) — 2026-10-27.
//
// ONE function, three jobs, so it is one paste into the Supabase dashboard:
//   POST {action:'checkout', bundle_id, return_url}  → { url }   (send the buyer to Stripe)
//   POST {action:'confirm',  session_id}             → { ok, bundle_id }  (buyer is back: record it)
//   POST  from Stripe with a Stripe-Signature header → the webhook (records it even if the
//                                                       buyer closed the tab before coming back)
// The database is the paywall (db/007): only THIS function, using the service role, can
// write public.purchases, and it only does so after Stripe reports the session as paid.
//
// Secrets (Supabase → Edge Functions → Secrets, set by Jed — never in this public repo):
//   STRIPE_SECRET_KEY      sk_test_… now, sk_live_… at launch
//   STRIPE_WEBHOOK_SECRET  whsec_… (optional until the webhook endpoint is added in Stripe)
// SUPABASE_URL and the project's secret key are provided by Supabase automatically.
//
// Deploy with "Enforce JWT verification" OFF: Stripe's webhook carries no Supabase JWT.
// checkout/confirm check the caller's session themselves (requireBuyer below).
//
// DATABASE ACCESS IS PLAIN fetch(), NO supabase-js (2026-10-28): the first deploy's supabase-js
// client read the paid bundle as if it were an anonymous visitor ("no such bundle"), because this
// project uses the NEW key system (sb_publishable_/sb_secret_) and that client sent the key the
// old way. Here the key is passed exactly as its kind requires — see dbHeaders().

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';

// The project's server-side key. New projects get SUPABASE_SECRET_KEYS (JSON: {"default":"sb_secret_…"});
// older ones only the legacy SUPABASE_SERVICE_ROLE_KEY (a JWT). Prefer the new one.
const SK = (() => {
  try {
    const j = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const v = j.default ?? Object.values(j)[0];
    if (v) return { key: String(v), src: 'SUPABASE_SECRET_KEYS' };
  } catch (_) { /* not set / not JSON → fall back */ }
  return { key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', src: 'SUPABASE_SERVICE_ROLE_KEY' };
})();
const SK_IS_JWT = SK.key.split('.').length === 3;

// An sb_secret_ key goes ONLY in `apikey` (the gateway then runs the request as service_role);
// a legacy JWT key must ALSO be the Bearer token, or PostgREST runs it as anon.
function dbHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: SK.key, 'Content-Type': 'application/json', ...extra };
  if (SK_IS_JWT) h.Authorization = 'Bearer ' + SK.key;
  return h;
}
// PostgREST call → { ok, status, body } (body = parsed JSON, or null).
async function rest(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    method: init.method ?? 'GET',
    headers: dbHeaders(init.headers),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

// Where a buyer may be sent back to after Stripe: the live site and local dev only.
const RETURN_OK = [/^https:\/\/(www\.)?akashictimes\.com\//, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Stripe REST, no SDK: form-encoded POST / plain GET ───────────────────────
async function stripe(path: string, form?: Record<string, string>) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message ?? 'Stripe error ' + res.status);
  return out;
}

// The caller must be a signed-in player WITH an email (Jed 2026-10-27: buyers sign in
// with email first, so a purchase follows them to any device). Anonymous sessions are refused.
async function requireBuyer(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  // Supabase Auth answers "who is this token?" — the token itself proves the session.
  const res = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SK.key, Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  const u = await res.json();
  if (!u?.id || u.is_anonymous || !u.email) return null;
  return u as { id: string; email: string };
}

// Record a PAID session as a purchase. Idempotent: the session id is unique, and the
// webhook and the buyer's return can both arrive — whichever is second is a no-op.
async function recordPurchase(s: any) {
  if (s.payment_status !== 'paid') return { ok: false, error: 'not paid yet' };
  const userId = s.metadata?.user_id, bundleId = Number(s.metadata?.bundle_id);
  if (!userId || !bundleId) return { ok: false, error: 'session has no bundle metadata' };
  const r = await rest('purchases?on_conflict=stripe_session_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: {
      user_id: userId, bundle_id: bundleId, amount_cents: s.amount_total ?? 0,
      currency: s.currency ?? 'usd', stripe_session_id: s.id, livemode: !!s.livemode,
    },
  });
  // 23505 = the (user, bundle) pair already exists from another session: still owned
  if (!r.ok && r.body?.code !== '23505') return { ok: false, error: r.body?.message ?? 'purchase write failed (' + r.status + ')' };
  return { ok: true, bundle_id: bundleId };
}

// ── checkout: create a Stripe Checkout Session for one bundle ────────────────
async function checkout(req: Request, body: any) {
  const u = await requireBuyer(req);
  if (!u) return json({ error: 'sign in with your email first' }, 401);
  // TEST MODE = testers only (db/009). While the key is sk_test_, the 4242 card "pays" for
  // anything, so only listed testers and admins may check out; everyone else gets 'store_soon'
  // (the page shows "the store opens soon"). A live key opens the store to all — no flag to flip.
  if (STRIPE_KEY.startsWith('sk_test_')) {
    const t = await rest('testers?select=user_id&user_id=eq.' + u.id);
    const a = await rest('admins?select=user_id&user_id=eq.' + u.id);
    if (!(t.ok && t.body?.length) && !(a.ok && a.body?.length)) return json({ error: 'store_soon' }, 403);
  }
  const bundleId = Number(body.bundle_id), back = String(body.return_url ?? '');
  if (!RETURN_OK.some((r) => r.test(back))) return json({ error: 'bad return_url' }, 400);

  const br = await rest('bundles?select=id,title,price_cents,published&id=eq.' + bundleId);
  if (!br.ok) return json({ error: 'bundle lookup failed: ' + (br.body?.message ?? br.status) }, 500);
  const b = br.body?.[0];
  if (!b || !b.published) return json({ error: 'no such bundle' }, 404);
  if (!(b.price_cents > 0)) return json({ error: 'this bundle is free' }, 400);
  const pr = await rest('purchases?select=id&user_id=eq.' + u.id + '&bundle_id=eq.' + bundleId);
  if (pr.ok && pr.body?.length) return json({ owned: true });

  const sep = back.includes('?') ? '&' : '?';
  const s = await stripe('checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(b.price_cents),
    'line_items[0][price_data][product_data][name]': 'Akashic Swaps bundle: ' + b.title,
    customer_email: u.email!,
    client_reference_id: u.id,
    'metadata[user_id]': u.id,
    'metadata[bundle_id]': String(b.id),
    // {CHECKOUT_SESSION_ID} is filled in by Stripe on the way back
    success_url: back + sep + 'checkout=success&bundle=' + b.id + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: back + sep + 'checkout=cancel&bundle=' + b.id,
  });
  return json({ url: s.url });
}

// ── confirm: the buyer is back from Stripe — look the session up and record it ─
async function confirm(req: Request, body: any) {
  const u = await requireBuyer(req);
  if (!u) return json({ error: 'sign in with your email first' }, 401);
  const id = String(body.session_id ?? '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: 'bad session id' }, 400);
  const s = await stripe('checkout/sessions/' + id);
  if (s.metadata?.user_id !== u.id) return json({ error: 'not your purchase' }, 403);
  const r = await recordPurchase(s);
  return json(r, r.ok ? 200 : 409);
}

// ── webhook: Stripe tells us a session finished ──────────────────────────────
// Signature check per Stripe's scheme: HMAC-SHA256 over "<t>.<raw body>" with the
// endpoint secret, compared against every v1= value, timestamp within 5 minutes.
async function verifySignature(raw: string, header: string) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2)).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + raw)));
  const hex = Array.from(mac, (x) => x.toString(16).padStart(2, '0')).join('');
  // constant-time compare against each candidate signature
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

async function webhook(req: Request, sig: string) {
  if (!WEBHOOK_SECRET) return json({ error: 'webhook secret not set' }, 500);
  const raw = await req.text();
  if (!(await verifySignature(raw, sig))) return json({ error: 'bad signature' }, 400);
  const evt = JSON.parse(raw);
  if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
    const r = await recordPurchase(evt.data.object);
    if (!r.ok && r.error !== 'not paid yet') return json(r, 500);    // 500 → Stripe retries later
  }
  return json({ received: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!STRIPE_KEY) return json({ error: 'STRIPE_SECRET_KEY is not set' }, 500);
  try {
    const sig = req.headers.get('Stripe-Signature');
    if (sig) return await webhook(req, sig);
    const body = await req.json().catch(() => ({}));
    // health: can this function read as the service role? (curl-able, reveals no secrets —
    // only which env var the key came from, its kind, and the HTTP status of a purchases read;
    // 200 = service role works, 401/403 = it is running as an anonymous visitor)
    if (body.action === 'health') {
      const r = await rest('purchases?select=id&limit=1');
      return json({ keySource: SK.src, keyKind: SK_IS_JWT ? 'jwt' : SK.key.startsWith('sb_secret_') ? 'sb_secret' : SK.key ? 'other' : 'missing', serviceRead: r.status });
    }
    if (body.action === 'checkout') return await checkout(req, body);
    if (body.action === 'confirm') return await confirm(req, body);
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
