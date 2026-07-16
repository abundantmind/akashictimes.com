-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — Supabase schema v1  (2026-07-15)
-- Run this ONCE in the Supabase SQL editor of a fresh project (whole file).
-- Design per the 2026-07-11 assessment: bundles/profiles/progress + RLS;
-- the static site talks to Postgres directly with the publishable anon key —
-- no API server. localStorage stays the logged-out tier; first sign-in merges.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles — one row per auth user, auto-created on signup ────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique check (char_length(username) between 3 and 24),
  -- mirrors localStorage: akashicswaps-path / akashicswaps-qualified / akashicswaps-lang
  path       text check (path in ('architect','explorer')),
  qualified  boolean not null default false,
  lang       text not null default 'en' check (lang in ('en','ko')),
  created_at timestamptz not null default now()
);

-- ── progress — per-level living state (STAR CANON, era 1) ───────────────────
-- mirrors localStorage akashicswaps-player: { level: { s: stars, rec: moveRecord } }
create table public.progress (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  level       int  not null check (level >= 1),
  stars       int  not null default 0 check (stars between 0 and 3),
  move_record int  not null default 0 check (move_record >= 0), -- 0 = no record yet
  updated_at  timestamptz not null default now(),
  primary key (user_id, level)
);

-- ── credits — append-only Marketplace Credit ledger ─────────────────────────
-- CREDIT RENEWAL canon (Jed 2026-07-13): re-achieving ★3 after a record reset
-- mints ANOTHER credit; credits are never revoked — hence a ledger, not a flag.
create table public.credits (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  level      int,  -- the level whose ★3 minted it (null for non-level grants)
  reason     text not null default 'three_star'
             check (reason in ('three_star','white_hat','grant')),
  granted_at timestamptz not null default now()
);

-- ── bundles — level packages: JSONB level data + relational marketplace meta ─
create table public.bundles (
  id          bigint generated always as identity primary key,
  author      uuid references public.profiles(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 80),
  data        jsonb not null,           -- the level JSONs, as authored
  price_cents int  not null default 0 check (price_cents >= 0),
  published   boolean not null default false,
  downloads   int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── auto-create a profile row when a user signs up ──────────────────────────
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── keep updated_at honest ───────────────────────────────────────────────────
create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger progress_touch before update on public.progress
  for each row execute function public.touch_updated_at();
create trigger bundles_touch before update on public.bundles
  for each row execute function public.touch_updated_at();

-- ═══ ROW-LEVEL SECURITY — the whole "no API server" bet rides on these ══════
alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.credits  enable row level security;
alter table public.bundles  enable row level security;

-- profiles: usernames are public (marketplace bylines); only you edit yours
create policy "profiles are readable"        on public.profiles for select using (true);
create policy "insert own profile"           on public.profiles for insert with check (id = auth.uid());
create policy "update own profile"           on public.profiles for update using (id = auth.uid());

-- progress: yours alone, both ways
create policy "read own progress"            on public.progress for select using (user_id = auth.uid());
create policy "insert own progress"          on public.progress for insert with check (user_id = auth.uid());
create policy "update own progress"          on public.progress for update using (user_id = auth.uid());

-- credits: read your own; client may mint its own ★3 credits for now.
-- KNOWN TRADE-OFF: client-side minting is as trustable as localStorage was
-- (i.e., not). When money attaches to credits, move minting to an edge
-- function and drop this insert policy.
create policy "read own credits"             on public.credits for select using (user_id = auth.uid());
create policy "insert own credits"           on public.credits for insert with check (user_id = auth.uid());

-- bundles: published ones are the storefront; authors see + manage their own
create policy "read published or own"        on public.bundles for select
  using (published or author = auth.uid());
create policy "insert own bundles"           on public.bundles for insert with check (author = auth.uid());
create policy "update own bundles"           on public.bundles for update using (author = auth.uid());
create policy "delete own bundles"           on public.bundles for delete using (author = auth.uid());
