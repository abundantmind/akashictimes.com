-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 007: bundle purchases (Stripe Checkout, $2)
-- (2026-10-27)  Run in the Supabase SQL editor, AFTER 006.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The Portrait bundle is the first one a player pays for. Until now a PUBLISHED
-- bundle's level data was readable by anyone ("read published or own"), so a
-- price would have been decoration. This migration makes the database the
-- paywall, the same way 005 made it the admin check:
--   · public.purchases — one row per (player, bundle) bought. Clients can READ
--     their own rows and can NEVER write one: only the `stripe` Edge Function
--     (service role) inserts, after Stripe says the payment is paid.
--   · Paid bundles drop out of direct table reads. The storefront comes from
--     storefront() (title, price, owned — no level data) and the levels from
--     bundle_levels(id), which refuses unless the bundle is free, yours, bought,
--     or you are an admin.
--   · publish_bundle() now stamps the marketplace price: $2 flat (Jed 2026-09-24:
--     "Players have to pay for any bundle beyond Go With the Flow, which is free";
--     $3 only if/when the game goes into the App Stores — 2026-10-24).
-- Free published bundles stay directly readable, so the live site's current
-- client keeps working until the new one ships. Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Purchases ────────────────────────────────────────────────────────────
create table if not exists public.purchases (
  id                bigint generated always as identity primary key,
  user_id           uuid   not null references auth.users(id) on delete cascade,
  bundle_id         bigint not null references public.bundles(id) on delete restrict,
  amount_cents      int    not null check (amount_cents >= 0),
  currency          text   not null default 'usd',
  stripe_session_id text   not null unique,       -- Stripe's Checkout Session id: the idempotency key
  livemode          boolean not null default false, -- false = a TEST-mode purchase (delete those before going live)
  created_at        timestamptz not null default now(),
  unique (user_id, bundle_id)                     -- a bundle is bought once
);
alter table public.purchases enable row level security;

-- Read your own purchases. NO insert/update/delete policy on purpose: a client can
-- never mint a purchase. The Edge Function writes with the service role, which RLS
-- does not apply to.
drop policy if exists "read own purchases" on public.purchases;
create policy "read own purchases" on public.purchases for select using (user_id = auth.uid());
grant select on public.purchases to authenticated;

-- ── 2. Paid bundles leave direct table reads ────────────────────────────────
-- Was: using (published or author = auth.uid()). Now a PAID published bundle is
-- only reachable through the two functions below (admins still read everything
-- via 005's "admins read all bundles").
drop policy if exists "read published or own" on public.bundles;
create policy "read published or own" on public.bundles for select
  using ((published and price_cents = 0) or author = auth.uid());

-- Does the caller own this bundle (free, theirs, bought, or an admin)?
create or replace function public.owns_bundle(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bundles b
     where b.id = p_id and b.published
       and (b.price_cents = 0
            or b.author = auth.uid()
            or public.is_admin()
            or exists (select 1 from public.purchases x where x.bundle_id = b.id and x.user_id = auth.uid()))
  );
$$;

-- The storefront: every published bundle, its price, and whether the caller owns
-- it. No level data — that only comes out of bundle_levels().
create or replace function public.storefront()
returns table (id bigint, title text, price_cents int, levels int, author_name text, owned boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.price_cents,
         case when jsonb_typeof(b.data) = 'array' then jsonb_array_length(b.data) else 0 end,
         coalesce(nullif(p.username, ''), nullif(p.handle, '')),
         public.owns_bundle(b.id),
         b.created_at
    from public.bundles b
    left join public.profiles p on p.id = b.author
   where b.published
   order by b.created_at desc;
$$;

-- One bundle's levels, for a player who owns it. Refuses everyone else.
create or replace function public.bundle_levels(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  if not public.owns_bundle(p_id) then
    raise exception 'bundle % is not yours to play — buy it first', p_id using errcode = '42501';
  end if;
  select data into d from public.bundles where id = p_id;
  return d;
end; $$;

revoke all on function public.owns_bundle(bigint)   from public;
revoke all on function public.storefront()          from public;
revoke all on function public.bundle_levels(bigint) from public;
grant execute on function public.owns_bundle(bigint)   to anon, authenticated;
grant execute on function public.storefront()          to anon, authenticated;
grant execute on function public.bundle_levels(bigint) to anon, authenticated;

-- ── 3. Publishing stamps the price ──────────────────────────────────────────
-- Same as 005's publish_bundle, plus price_cents = 200. Authors never set a price;
-- the marketplace has one.
create or replace function public.publish_bundle(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  update public.bundles
     set published = true, published_at = now(), returned_at = null, review_note = null,
         price_cents = 200,                                   -- $2 flat, every marketplace bundle
         updated_at = now()
   where id = p_id and published = false;
  if not found then
    raise exception 'bundle % is not a draft (already published, or no such id)', p_id;
  end if;
end; $$;
revoke all on function public.publish_bundle(bigint) from public;
grant execute on function public.publish_bundle(bigint) to authenticated;  -- the function itself refuses non-admins

-- ── Check it ────────────────────────────────────────────────────────────────
-- select * from public.storefront();          -- empty until a bundle is published
-- select * from public.purchases;             -- test purchases land here (livemode = false)
