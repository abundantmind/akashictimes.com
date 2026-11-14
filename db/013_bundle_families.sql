-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 013: bundle families
-- (2026-11-13)  Run in the Supabase SQL editor, AFTER 012.
--
-- ── What a family is (Jed 2026-11-12) ───────────────────────────────────────
--   · A run of bundles numbered straight through. Chapter 1 = levels 1–25,
--     chapter 2 = levels 26–50, and so on.
--   · ONE orientation per family. Nothing Landscape ever unlocks Portrait.
--   · Any chapter can be BOUGHT at any time. It can't be PLAYED until every level
--     of the chapter before it has 3 stars. That's a game rule, so the page
--     enforces it, like level-by-level gating; the database only says who OWNS what.
--   · The first family is GROUND ZERO (Landscape):
--       chapter 1 = Akashic Flow (ex "Go with the Flow"), the free built-in bundle
--                   (bundle id 0, not a row in public.bundles)
--       chapter 2 = Akashic Window (public.bundles id 3), levels 26–50
--
-- ── How it's stored: numbering only ────────────────────────────────────────
-- Nothing about a bundle's levels changes. Level files stay 1–25 inside every
-- bundle; progress, purchases and approvals stay keyed by (bundle, local level).
-- A family only tells the page what number to SHOW: family level =
-- first_level + local level − 1.
--
-- Families are set by an admin (this SQL editor). Published bundles stay final:
-- placing one in a family changes its numbering, never its levels.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Families ─────────────────────────────────────────────────────────────
create table if not exists public.families (
  id           bigint generated always as identity primary key,
  name         text not null unique check (char_length(name) between 1 and 60),
  orientation  text not null check (orientation in ('landscape', 'portrait')),
  -- true = chapter 1 is the free built-in bundle (bundle id 0), which has no row
  -- in public.bundles. Only Ground Zero has this.
  native_head  boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.families enable row level security;
-- Everyone can read families (they're part of the storefront). Only admins write,
-- here in the SQL editor.
drop policy if exists "read families" on public.families;
create policy "read families" on public.families for select using (true);
grant select on public.families to anon, authenticated;

-- ── 2. A bundle's place in its family ───────────────────────────────────────
alter table public.bundles add column if not exists family_id   bigint references public.families(id) on delete set null;
alter table public.bundles add column if not exists family_seq  int check (family_seq >= 1);          -- chapter number
alter table public.bundles add column if not exists first_level int not null default 1 check (first_level >= 1);
-- One bundle per chapter slot.
create unique index if not exists bundles_family_slot on public.bundles(family_id, family_seq) where family_id is not null;

-- ── 3. Ground Zero ──────────────────────────────────────────────────────────
insert into public.families (name, orientation, native_head)
values ('Ground Zero', 'landscape', true)
on conflict (name) do nothing;

-- Akashic Window = chapter 2, levels 26–50. (Chapter 1, Akashic Flow, is bundle 0.)
-- Look first:  select id, title from public.bundles where published;
update public.bundles
   set family_id   = (select id from public.families where name = 'Ground Zero'),
       family_seq  = 2,
       first_level = 26
 where id = 3 and title = 'Akashic Window';

-- ── 4. The storefront carries the family ────────────────────────────────────
-- Same as 007's storefront() plus the family columns and the bundle's orientation
-- (the family's). The return type changes, so the old function is dropped first.
drop function if exists public.storefront();
create function public.storefront()
returns table (id bigint, title text, price_cents int, levels int, author_name text, owned boolean,
               created_at timestamptz, family_id bigint, family_name text, family_seq int,
               first_level int, orientation text)
language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.price_cents,
         case when jsonb_typeof(b.data) = 'array' then jsonb_array_length(b.data) else 0 end,
         coalesce(nullif(p.username, ''), nullif(p.handle, '')),
         public.owns_bundle(b.id),
         b.created_at,
         f.id, f.name, b.family_seq, b.first_level, f.orientation
    from public.bundles b
    left join public.profiles p on p.id = b.author
    left join public.families f on f.id = b.family_id
   where b.published
   order by f.name nulls last, b.family_seq, b.created_at desc;
$$;
revoke all on function public.storefront() from public;
grant execute on function public.storefront() to anon, authenticated;

-- ── 5. Leaderboard reach = how far down GROUND ZERO a player has gotten ─────
-- Was: the highest level played in bundle 0 only (1–25). Now: the highest FAMILY
-- level across all of Ground Zero, so a player on Akashic Window level 13 shows 38.
-- Total stars is unchanged (every bundle counts).
create or replace function public.standings()
returns table(display_name text, total_stars int, reach int)
language sql security definer set search_path = public stable as $$
  select coalesce(p.username, p.handle),
         coalesce((select sum(pr.stars)::int from public.progress pr where pr.user_id = p.id), 0),
         coalesce((select max(case when pr.bundle_id = 0 then pr.level
                                   else b.first_level + pr.level - 1 end)::int
                     from public.progress pr
                     left join public.bundles b on b.id = pr.bundle_id
                    where pr.user_id = p.id
                      and (pr.bundle_id = 0
                           or b.family_id = (select id from public.families where native_head limit 1))), 0)
    from public.profiles p
   where p.stars_public and coalesce(p.username, p.handle) is not null
   order by 2 desc, 3 desc, coalesce(p.username, p.handle) asc;
$$;
grant execute on function public.standings() to anon, authenticated;

-- ── Check it ────────────────────────────────────────────────────────────────
-- select id, title, family_name, family_seq, first_level, orientation from public.storefront();
--   → Akashic Window: Ground Zero · 2 · 26 · landscape
-- select * from public.standings() limit 10;
