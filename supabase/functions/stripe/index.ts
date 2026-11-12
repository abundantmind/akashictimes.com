// AkashicSwaps — the `stripe` Edge Function: bundle checkout ($2.50) — 2026-10-27; Architect payouts — 2026-11-12.
//
// ONE function, several jobs, so it is one paste into the Supabase dashboard:
//   POST {action:'checkout', bundle_id, return_url}  → { url }   (send the buyer to Stripe)
//   POST {action:'confirm',  session_id}             → { ok, bundle_id }  (buyer is back: record it)
//   POST  from Stripe with a Stripe-Signature header → the webhook (records it even if the
//                                                       buyer closed the tab before coming back)
// ARCHITECT PAYOUTS (Stripe Connect Express, db/012 — 2026-11-12):
//   POST {action:'connect_onboard', return_url}  → { url }  Stripe's onboarding form (makes the account first time)
//   POST {action:'connect_status'}               → { connected, details_submitted, payouts_enabled }
//   POST {action:'connect_dashboard'}            → { url }  their Stripe Express dashboard (one-time login link)
//   POST {action:'payouts_preview'}  (admin)     → who is owed, who's eligible, platform balance
//   POST {action:'payouts_run'}      (admin)     → one Transfer per eligible Architect for this month
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
// idemKey: Stripe's Idempotency-Key — the same key within 24h returns the FIRST result instead
// of doing it again (used for payouts, so a retried run can never send a second transfer).
async function stripe(path: string, form?: Record<string, string>, idemKey?: string) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: form ? 'POST' : 'GET',
    headers,
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
// THE SPLIT (Jed 2026-11-11, "90% after card fees"): Stripe's fee comes off the top, the
// Architect earns 90% of the rest (rounded DOWN — the odd cent stays with AkashicTimes).
// fee = Stripe's ACTUAL fee for this charge, read from its balance transaction; if Stripe
// hasn't posted it yet, the published 2.9% + 30¢ estimate (US card).
const AUTHOR_SHARE = 0.9;
const estimateFee = (amount: number) => Math.round(amount * 0.029) + 30;
async function stripeFee(s: any, amount: number) {
  try {
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
    if (!pi) return estimateFee(amount);
    const p = await stripe('payment_intents/' + pi + '?expand[]=latest_charge.balance_transaction');
    const fee = p?.latest_charge?.balance_transaction?.fee;
    return typeof fee === 'number' ? fee : estimateFee(amount);
  } catch (_) { return estimateFee(amount); }
}

async function recordPurchase(s: any) {
  if (s.payment_status !== 'paid') return { ok: false, error: 'not paid yet' };
  const userId = s.metadata?.user_id, bundleId = Number(s.metadata?.bundle_id);
  if (!userId || !bundleId) return { ok: false, error: 'session has no bundle metadata' };
  // Already recorded (the webhook and the buyer's return both arrive)? Nothing to do —
  // and the split stamped the first time is never recomputed.
  const seen = await rest('purchases?select=id&stripe_session_id=eq.' + encodeURIComponent(s.id));
  if (seen.ok && seen.body?.length) return { ok: true, bundle_id: bundleId };
  // Who authored the bundle → who earns from this sale.
  const br = await rest('bundles?select=author&id=eq.' + bundleId);
  const authorId = br.ok ? br.body?.[0]?.author ?? null : null;
  const amount = s.amount_total ?? 0;
  const fee = amount > 0 ? await stripeFee(s, amount) : 0;
  const authorCents = authorId ? Math.max(0, Math.floor((amount - fee) * AUTHOR_SHARE)) : 0;
  const r = await rest('purchases?on_conflict=stripe_session_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: {
      user_id: userId, bundle_id: bundleId, amount_cents: amount,
      currency: s.currency ?? 'usd', stripe_session_id: s.id, livemode: !!s.livemode,
      author_id: authorId, fee_cents: fee, author_cents: authorCents,
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

// ═══ ARCHITECT PAYOUTS — Stripe Connect Express (db/012, 2026-11-12) ═════════
// "Separate charges and transfers": buyers pay the platform (checkout above, unchanged);
// each sale's author_cents piles up in our ledger from the FIRST sale, no Stripe account
// needed. When an Architect wants to be paid they connect a Stripe Express account, and
// once a month the Admin panel sends each Architect with ≥ $25 one Transfer.
const PAYOUT_THRESHOLD = 2500;   // $25 (Jed 2026-11-12) — smaller balances carry over

async function isAdmin(uid: string) {
  const a = await rest('admins?select=user_id&user_id=eq.' + uid);
  return !!(a.ok && a.body?.length);
}
// Stripe's account → our cached status row. payouts_enabled needs BOTH Stripe's flag and an
// active transfers capability (the capability is what lets us send money to the account).
async function syncAccount(uid: string, acctId: string) {
  const a = await stripe('accounts/' + acctId);
  const row = {
    user_id: uid, stripe_account_id: acctId,
    details_submitted: !!a.details_submitted,
    payouts_enabled: !!a.payouts_enabled && a.capabilities?.transfers === 'active',
    updated_at: new Date().toISOString(),
  };
  await rest('architect_accounts?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: row,
  });
  return row;
}
async function myAccount(uid: string) {
  const r = await rest('architect_accounts?select=stripe_account_id&user_id=eq.' + uid);
  return r.ok ? (r.body?.[0]?.stripe_account_id as string | undefined) : undefined;
}

// connect_onboard: make the Express account the first time, then hand back a one-time link
// to Stripe's onboarding form (identity, bank account, tax info — Stripe holds all of it,
// we never see it). The same call resumes an unfinished form.
async function connectOnboard(req: Request, body: any) {
  const u = await requireBuyer(req);
  if (!u) return json({ error: 'sign in with your email first' }, 401);
  const back = String(body.return_url ?? '');
  if (!RETURN_OK.some((r) => r.test(back))) return json({ error: 'bad return_url' }, 400);
  let acct = await myAccount(u.id);
  if (!acct) {
    // Only Architects with a published bundle (or an admin, for testing) get an account —
    // keeps strangers from minting empty Stripe accounts on our platform.
    const mine = await rest('bundles?select=id&published=is.true&limit=1&author=eq.' + u.id);
    if (!(mine.ok && mine.body?.length) && !(await isAdmin(u.id))) return json({ error: 'publish a bundle first' }, 403);
    const a = await stripe('accounts', {
      type: 'express',
      country: 'US',                                   // v1 = US Architects (cross-border transfers need extra Stripe setup)
      email: u.email,
      business_type: 'individual',
      'capabilities[transfers][requested]': 'true',    // receive our transfers — no card processing of their own
      'business_profile[product_description]': 'Akashic Swaps level bundles sold on akashictimes.com',
      'business_profile[url]': 'https://akashictimes.com',
      'metadata[user_id]': u.id,
    }, 'acct-' + u.id);                                // a double-click can't make two accounts
    acct = a.id as string;
    const w = await rest('architect_accounts', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: { user_id: u.id, stripe_account_id: acct },
    });
    if (!w.ok && w.body?.code !== '23505') return json({ error: 'could not save the account: ' + (w.body?.message ?? w.status) }, 500);
  }
  const sep = back.includes('?') ? '&' : '?';
  const link = await stripe('account_links', {
    account: acct!,
    type: 'account_onboarding',
    refresh_url: back + sep + 'connect=refresh',       // link expired → the page asks for a fresh one
    return_url: back + sep + 'connect=return',         // form done (or left) → the page re-checks status
  });
  return json({ url: link.url });
}

// connect_status: re-read the account from Stripe (no Connect webhook needed) + cache it.
async function connectStatus(req: Request) {
  const u = await requireBuyer(req);
  if (!u) return json({ error: 'sign in with your email first' }, 401);
  const acct = await myAccount(u.id);
  if (!acct) return json({ connected: false, details_submitted: false, payouts_enabled: false });
  const row = await syncAccount(u.id, acct);
  return json({ connected: true, details_submitted: row.details_submitted, payouts_enabled: row.payouts_enabled });
}

// connect_dashboard: a one-time login link to the Architect's Stripe Express dashboard
// (payout history, bank account, tax forms). Only works after onboarding is submitted.
async function connectDashboard(req: Request) {
  const u = await requireBuyer(req);
  if (!u) return json({ error: 'sign in with your email first' }, 401);
  const acct = await myAccount(u.id);
  if (!acct) return json({ error: 'no Stripe account yet' }, 404);
  const l = await stripe('accounts/' + acct + '/login_links', {});
  return json({ url: l.url });
}

// ── the monthly run (admin) ──────────────────────────────────────────────────
const period = () => new Date().toISOString().slice(0, 7);   // 'YYYY-MM', UTC

async function ledger() {
  const r = await rest('rpc/payout_ledger', { method: 'POST', body: {} });
  if (!r.ok) throw new Error('payout_ledger failed: ' + (r.body?.message ?? r.status) + ' — has migration 012 been run?');
  return (r.body ?? []) as any[];
}
// Platform money that can be transferred NOW (card payments take ~2 business days to settle).
async function availableUsd() {
  const b = await stripe('balance');
  return (b.available ?? []).filter((x: any) => x.currency === 'usd').reduce((t: number, x: any) => t + x.amount, 0);
}

async function payoutsPreview(req: Request) {
  const u = await requireBuyer(req);
  if (!u || !(await isAdmin(u.id))) return json({ error: 'admins only' }, 403);
  const [rows, avail] = await Promise.all([ledger(), availableUsd()]);
  const pr = await rest('payouts?select=user_id&period=eq.' + period());
  const done = new Set((pr.body ?? []).map((x: any) => x.user_id));
  return json({
    period: period(), threshold_cents: PAYOUT_THRESHOLD, available_cents: avail,
    rows: rows.map((r) => ({ ...r, paid_this_period: done.has(r.user_id) })),
  });
}

// One Transfer per eligible Architect, for their WHOLE balance. Safe to click twice:
// payouts has unique(user_id, period) and every transfer carries an idempotency key
// built from the Architect + month, so a retry returns the first transfer, never a second.
// CONNECT FEES (Stripe: $2 per active account-month + 0.25% + 25¢ per payout) are paid by
// AkashicTimes — the Architect gets the full balance, matching "90% after card fees".
async function payoutsRun(req: Request) {
  const u = await requireBuyer(req);
  if (!u || !(await isAdmin(u.id))) return json({ error: 'admins only' }, 403);
  const per = period(), out: any[] = [];
  let avail = await availableUsd();
  for (const r of await ledger()) {
    if (!r.eligible) continue;
    const item: any = { architect: r.architect, cents: Number(r.balance_cents) };
    try {
      const already = await rest('payouts?select=id&user_id=eq.' + r.user_id + '&period=eq.' + per);
      if (already.ok && already.body?.length) { item.skipped = 'already paid this month'; out.push(item); continue; }
      // Stripe's word, not our cache: the account must still be able to receive money.
      const acct = await syncAccount(r.user_id, r.stripe_account_id);
      if (!acct.payouts_enabled) { item.skipped = 'Stripe account not ready'; out.push(item); continue; }
      if (item.cents > avail) { item.skipped = 'not enough settled balance on the platform'; out.push(item); continue; }
      const t = await stripe('transfers', {
        amount: String(item.cents), currency: 'usd', destination: r.stripe_account_id,
        description: 'Akashic Swaps Architect payout ' + per,
        transfer_group: 'payouts-' + per,
        'metadata[user_id]': r.user_id, 'metadata[period]': per,
      }, 'payout-' + r.user_id + '-' + per);
      const w = await rest('payouts', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: { user_id: r.user_id, stripe_account_id: r.stripe_account_id, amount_cents: item.cents, period: per, stripe_transfer_id: t.id },
      });
      if (!w.ok && w.body?.code !== '23505') item.warning = 'transfer ' + t.id + ' sent but not recorded: ' + (w.body?.message ?? w.status) + ' — run again to record it';
      item.transfer = t.id; avail -= item.cents;
    } catch (e) { item.error = String((e as Error).message ?? e); }
    out.push(item);
  }
  return json({ period: per, results: out });
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
    if (body.action === 'connect_onboard') return await connectOnboard(req, body);
    if (body.action === 'connect_status') return await connectStatus(req);
    if (body.action === 'connect_dashboard') return await connectDashboard(req);
    if (body.action === 'payouts_preview') return await payoutsPreview(req);
    if (body.action === 'payouts_run') return await payoutsRun(req);
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
