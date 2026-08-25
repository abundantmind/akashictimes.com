-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 003: bundle-scoped progress
-- (2026-08-25)  Run ONCE in the Supabase SQL editor, AFTER schema.sql + 002.
-- Fully additive — nothing here drops data. Existing rows backfill to
-- bundle_id=0 automatically via the column default.
--
-- ── Why (project_marketplace_pivot / project_launch_plan_bundle2) ───────────
-- public.progress was keyed (user_id, level) only. The moment a real
-- community bundle gets played, its "Level 1" collides with native
-- "Go with the Flow"'s Level 1 in the same row, silently corrupting both.
-- bundle_id=0 is a SENTINEL for native "Go with the Flow" — deliberately NOT
-- a row in public.bundles (that table is for community submissions only), so
-- none of the 25 file-based native levels or existing progress rows move.
-- Community bundles use their real public.bundles.id (identity starts at 1,
-- so no collision with the 0 sentinel is possible).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. progress.bundle_id — additive column, existing rows backfill to 0 ────
alter table public.progress
  add column if not exists bundle_id bigint not null default 0;

-- ── 2. widen the primary key so per-bundle level numbers don't collide ──────
alter table public.progress drop constraint if exists progress_pkey;
alter table public.progress add primary key (user_id, bundle_id, level);

-- ── 3. standings() — reach must stay scoped to NATIVE progression ───────────
-- Once community bundles introduce their own overlapping level numbers,
-- max(level) across every bundle_id is meaningless as "current level
-- attained". Total stars still sums across every bundle (more content = more
-- stars — already the documented intent in 002).
create or replace function public.standings()
returns table(display_name text, total_stars int, reach int)
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(p.username, p.handle),
         coalesce((select sum(pr.stars)::int
            from public.progress pr where pr.user_id = p.id), 0),
         coalesce((select max(pr.level)::int
            from public.progress pr where pr.user_id = p.id and pr.bundle_id = 0), 0)
  from public.profiles p
  where p.stars_public and coalesce(p.username, p.handle) is not null
  order by 2 desc, 3 desc, coalesce(p.username, p.handle) asc;
$$;

grant execute on function public.standings() to anon, authenticated;
