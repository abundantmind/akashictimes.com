-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 012: Architect payouts (Stripe Connect Express)
-- (2026-11-12)  Run in the Supabase SQL editor, AFTER 011.
--
-- ── The model (Jed 2026-11-11 / 11-12) ──────────────────────────────────────
--   · A sale is $2.50. Stripe's card fee comes off the top, then the Architect
--     earns 90% of what's left (≈ $1.91); AkashicTimes keeps the rest (≈ $0.21).
--   · Payouts are MONTHLY, once an Architect's balance reaches $25. Smaller
--     balances carry over to the next month.
--   · An Architect needs NO Stripe account to sell. Earnings pile up here, in our
--     ledger, from the first sale. They connect Stripe (Express onboarding:
--     identity, bank, tax form) only when they want to be paid.
--
-- ── How the money moves ("separate charges and transfers") ─────────────────
-- Checkout charges the buyer on the PLATFORM account, as it does today. Each
-- sale's split is written into purchases (§2) at the moment it's recorded. Once
-- a month the Admin panel's "Run payouts" sends one Stripe Transfer per eligible
-- Architect to their connected account (§3 records it); Stripe then pays that
-- out to their bank.
--
--   balance = Σ author_cents of their LIVE sales − Σ amount_cents already paid
--
-- Every write here is done by the `stripe` Edge Function with the service role.
-- Clients only READ their own rows, and only through the functions in §4.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. An Architect's connected Stripe account ──────────────────────────────
create table if not exists public.architect_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id  text not null unique,           -- acct_… (Express)
  details_submitted  boolean not null default false, -- they finished Stripe's onboarding form
  payouts_enabled    boolean not null default false, -- Stripe says money can reach their bank
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.architect_accounts enable row level security;
-- Read your own row. No insert/update/delete policy: only the Edge Function writes.
drop policy if exists "read own architect account" on public.architect_accounts;
create policy "read own architect account" on public.architect_accounts for select using (user_id = auth.uid());
grant select on public.architect_accounts to authenticated;
grant select, insert, update on public.architect_accounts to service_role;

-- ── 2. The split, stamped on each sale ──────────────────────────────────────
-- Written once, when the purchase is recorded, so a later change to the split
-- never rewrites history. fee_cents is Stripe's ACTUAL fee for that charge
-- (from its balance transaction), or the 2.9% + 30¢ estimate if Stripe hasn't
-- reported it yet.
alter table public.purchases add column if not exists author_id    uuid references auth.users(id) on delete set null;
alter table public.purchases add column if not exists fee_cents    int check (fee_cents >= 0);
alter table public.purchases add column if not exists author_cents int check (author_cents >= 0);
create index if not exists purchases_author_idx on public.purchases(author_id) where livemode;

-- Backfill any sale recorded before this migration (live ones only matter).
-- Same formula the Edge Function uses: estimated fee, then 90% of the rest, rounded down.
update public.purchases p
   set author_id    = b.author,
       fee_cents    = round(p.amount_cents * 0.029) + 30,
       author_cents = greatest(0, floor((p.amount_cents - (round(p.amount_cents * 0.029) + 30)) * 0.9))::int
  from public.bundles b
 where b.id = p.bundle_id and p.author_cents is null and p.amount_cents > 0;

-- ── 3. Payouts: one row per Stripe Transfer ─────────────────────────────────
create table if not exists public.payouts (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete restrict,
  stripe_account_id   text not null,
  amount_cents        int  not null check (amount_cents > 0),
  period              text not null,                 -- 'YYYY-MM' (UTC) of the run
  stripe_transfer_id  text not null unique,          -- tr_…
  created_at          timestamptz not null default now(),
  unique (user_id, period)                            -- one payout per Architect per month: a second click can't double-pay
);
alter table public.payouts enable row level security;
drop policy if exists "read own payouts" on public.payouts;
create policy "read own payouts" on public.payouts for select using (user_id = auth.uid());
grant select on public.payouts to authenticated;
grant select, insert on public.payouts to service_role;
grant usage on sequence public.payouts_id_seq to service_role;

-- ── 4. Reading it ───────────────────────────────────────────────────────────
-- The caller's own earnings, for the editor's Earnings panel. SECURITY DEFINER
-- because purchases' RLS shows a row to its BUYER, not to the bundle's author;
-- this returns only totals and per-bundle counts, never who bought.
create or replace function public.my_earnings()
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select p.bundle_id, count(*) as sales, coalesce(sum(p.author_cents), 0) as cents
      from public.purchases p
     where p.author_id = auth.uid() and p.livemode
     group by p.bundle_id
  )
  select jsonb_build_object(
    'earned_cents', coalesce((select sum(cents) from s), 0),
    'paid_cents',   coalesce((select sum(amount_cents) from public.payouts where user_id = auth.uid()), 0),
    'sales',        coalesce((select sum(sales) from s), 0),
    'threshold_cents', 2500,
    'bundles', coalesce((select jsonb_agg(jsonb_build_object('title', b.title, 'sales', s.sales, 'cents', s.cents) order by s.cents desc)
                           from s join public.bundles b on b.id = s.bundle_id), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'cents', amount_cents, 'at', created_at) order by created_at desc)
                           from public.payouts where user_id = auth.uid()), '[]'::jsonb)
  );
$$;
revoke all on function public.my_earnings() from public;
grant execute on function public.my_earnings() to authenticated;

-- Who is owed money right now: every Architect with a positive balance, their
-- Stripe status, and whether they clear the $25 bar. The Edge Function reads
-- this (service role) for the Admin panel's preview and for the payout run.
-- Admins are left out: an admin's own bundles are AkashicTimes' revenue already.
create or replace function public.payout_ledger()
returns table (user_id uuid, architect text, balance_cents bigint, stripe_account_id text,
               payouts_enabled boolean, eligible boolean)
language sql stable security definer set search_path = public as $$
  with earned as (
    select author_id as uid, sum(author_cents) as cents
      from public.purchases where livemode and author_id is not null group by author_id
  ), paid as (
    select user_id as uid, sum(amount_cents) as cents from public.payouts group by user_id
  )
  select e.uid,
         coalesce(pr.username, pr.handle, e.uid::text),
         (e.cents - coalesce(pd.cents, 0))::bigint,
         a.stripe_account_id,
         coalesce(a.payouts_enabled, false),
         (e.cents - coalesce(pd.cents, 0)) >= 2500 and coalesce(a.payouts_enabled, false)
    from earned e
    left join paid pd on pd.uid = e.uid
    left join public.architect_accounts a on a.user_id = e.uid
    left join public.profiles pr on pr.id = e.uid
   where (e.cents - coalesce(pd.cents, 0)) > 0
     and not exists (select 1 from public.admins ad where ad.user_id = e.uid)
   order by 3 desc;
$$;
revoke all on function public.payout_ledger() from public, anon, authenticated;
grant execute on function public.payout_ledger() to service_role;

-- ── Check it ────────────────────────────────────────────────────────────────
-- select * from public.payout_ledger();                       -- (as postgres) who is owed
-- select author_id, amount_cents, fee_cents, author_cents from public.purchases where livemode;
