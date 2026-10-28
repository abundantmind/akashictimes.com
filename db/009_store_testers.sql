-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 009: store testers (test-mode checkout on the LIVE site)
-- (2026-10-28)  Run in the Supabase SQL editor, AFTER 008.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Jed 2026-10-28: keep the TEST store running until Match3Lover (an architect in
-- England) has test-bought both of Jed's bundles — so he can see the whole loop
-- and maybe publish his own. That means the checkout must go LIVE on
-- akashictimes.com while Stripe is still in TEST mode, where the card
-- 4242 4242 4242 4242 "pays" for anything. So while the Stripe key is a TEST key,
-- the `stripe` Edge Function only opens checkout for the people listed here (and
-- admins); everyone else sees "the store opens soon".
-- The switch is the Stripe key itself (sk_test_ vs sk_live_), not a flag someone
-- has to remember to flip: put in the live key and the store is open to all.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.testers (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,                                   -- who, and why they're testing
  added_at timestamptz not null default now()
);
alter table public.testers enable row level security;
-- No policies on purpose (like public.admins): invisible to every client role.
-- Only this SQL editor and the Edge Function (service role) read it.

-- Testers. Each line looks the account up; nothing is inserted if it doesn't match.
insert into public.testers (user_id, note)
  select id, 'Match3Lover — test purchases of Jed''s bundles'
    from public.profiles where username ilike 'match3lover'   -- case-insensitive: he has two accounts (match3lover + Match3lover)
  on conflict do nothing;
insert into public.testers (user_id, note)
  select id, 'Heffalump — Jed''s own test buyer'
    from auth.users where email = 'jed.mitchener+heffalump@gmail.com'
  on conflict do nothing;

-- ── Check it ────────────────────────────────────────────────────────────────
-- select t.note, p.username from public.testers t left join public.profiles p on p.id = t.user_id;
--   → expect 2 rows. If Match3Lover is missing, his username may be spelled differently:
--     select username, handle from public.profiles where username ilike '%match%';
-- When the store goes live: delete from public.purchases where livemode = false;
