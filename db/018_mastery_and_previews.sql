-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 018: Akashic Flow mastery, Erase Stars, bundle previews
-- (2026-11-26)  Run in the Supabase SQL editor BEFORE the site ships (the new
-- page calls these functions; on the old database it just falls back quietly).
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--   Jed 2026-11-26: 75/75 on Akashic Flow (Ground Zero chapter 1) is a moment. It
--   opens the worldwide leaderboard and Akashic Window, and the player may then
--   ERASE their stars to keep playing Akashic Flow free, forever. Mastery is
--   PERMANENT: erasing resets play only. Board standing, Window access and the
--   mastery itself stay. The board shows "Mastered #N" in the order players got there.
--   Shoppers get a PREVIEW of a paid bundle before buying: a picture of every level
--   (made when an admin approves it) and level 1 playable for 10 moves.
--
-- ── What ─────────────────────────────────────────────────────────────────────
--   §1  progress.best_stars — the most stars a level has EVER held. A trigger keeps
--       it at max(old best, new stars), so writing stars = 0 (Erase) can't lower
--       it, and a client can't write it directly. The board ranks on it.
--   §2  erase_stars(bundle, level?) — sets your stars + move record on that bundle
--       (or one level of it) to 0 in the cloud, so a sign-in on another device
--       can't fold the old stars back in. best_stars is untouched (§1).
--   §3  profiles.mastered_at + record_mastery() — stamps the FIRST time you held
--       75/75 on Akashic Flow (checked here, from best_stars), returns your #.
--       my_mastery() reads it back (a new device learns it on sign-in).
--   §4  standings() — ranks on best_stars and adds mastered_rank (null = not yet).
--   §5  bundle_previews — one picture per level, written by admins, readable by
--       anyone while the bundle is published. bundle_preview_level(id) hands out
--       LEVEL 1 ONLY of a published bundle, so it can be played for 10 moves.
--
-- ── Trust note ──────────────────────────────────────────────────────────────
--   Progress rows are written by the player's own device (as since 002), so a
--   determined cheater could forge stars and therefore mastery. Same trust level
--   as the board has always had; nothing here makes it weaker.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. best_stars: the high-water mark that Erase can't lower ────────────────
alter table public.progress
  add column if not exists best_stars int not null default 0 check (best_stars between 0 and 3);
update public.progress set best_stars = stars where best_stars < stars;   -- backfill: today's stars ARE the best so far

create or replace function public.progress_keep_best()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.best_stars := new.stars;                                   -- ignore any value the client sent
  else
    new.best_stars := greatest(old.best_stars, new.stars);         -- only ever rises
  end if;
  return new;
end; $$;
drop trigger if exists progress_keep_best on public.progress;
create trigger progress_keep_best before insert or update on public.progress
  for each row execute function public.progress_keep_best();

-- ── 2. erase_stars: a fresh run, in the cloud too ────────────────────────────
-- p_level null = the whole bundle (Erase Stars); a number = one level (the per-level
-- reset after three non-improving finishes, which until now only cleared the device
-- and came back on the next sign-in).
create or replace function public.erase_stars(p_bundle bigint, p_level int default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  update public.progress
     set stars = 0, move_record = 0, updated_at = now()
   where user_id = auth.uid() and bundle_id = p_bundle
     and (p_level is null or level = p_level);
  get diagnostics n = row_count;
  return n;                                                         -- rows reset
end; $$;
revoke all on function public.erase_stars(bigint, int) from public;
grant execute on function public.erase_stars(bigint, int) to authenticated;

-- ── 3. mastery: the first time you held 75/75 on Akashic Flow ────────────────
alter table public.profiles add column if not exists mastered_at timestamptz;

-- Stamps mastered_at once (never moves after) if your best stars on bundle 0,
-- levels 1–25, add up to 75. Returns {mastered_at, rank}, or nulls if not there yet.
create or replace function public.record_mastery()
returns table(mastered_at timestamptz, rank int)
language plpgsql security definer set search_path = public as $$
declare v_best int; v_at timestamptz;
begin
  if auth.uid() is null then return; end if;
  select coalesce(sum(best_stars), 0) into v_best
    from public.progress
   where user_id = auth.uid() and bundle_id = 0 and level between 1 and 25;
  if v_best >= 75 then
    update public.profiles p set mastered_at = coalesce(p.mastered_at, now()) where p.id = auth.uid();
  end if;
  select p.mastered_at into v_at from public.profiles p where p.id = auth.uid();
  if v_at is null then return; end if;
  return query select v_at, (select count(*)::int from public.profiles q where q.mastered_at <= v_at);
end; $$;
revoke all on function public.record_mastery() from public;
grant execute on function public.record_mastery() to authenticated;

-- Read-only twin: what this player already has (a new device asks on sign-in).
create or replace function public.my_mastery()
returns table(mastered_at timestamptz, rank int)
language sql stable security definer set search_path = public as $$
  select p.mastered_at, (select count(*)::int from public.profiles q where q.mastered_at <= p.mastered_at)
    from public.profiles p
   where p.id = auth.uid() and p.mastered_at is not null;
$$;
revoke all on function public.my_mastery() from public;
grant execute on function public.my_mastery() to authenticated;

-- ── 4. standings(): best stars + the mastery order ───────────────────────────
-- Same shape as 013's, plus mastered_rank. Ranked on best_stars so Erase never
-- costs a player their place.
drop function if exists public.standings();
create function public.standings()
returns table(display_name text, total_stars int, reach int, mastered_rank int)
language sql security definer set search_path = public stable as $$
  select coalesce(p.username, p.handle),
         coalesce((select sum(pr.best_stars)::int from public.progress pr where pr.user_id = p.id), 0),
         coalesce((select max(case when pr.bundle_id = 0 then pr.level
                                   else b.first_level + pr.level - 1 end)::int
                     from public.progress pr
                     left join public.bundles b on b.id = pr.bundle_id
                    where pr.user_id = p.id
                      and (pr.bundle_id = 0
                           or b.family_id = (select id from public.families where native_head limit 1))), 0),
         case when p.mastered_at is null then null
              else (select count(*)::int from public.profiles q where q.mastered_at <= p.mastered_at) end
    from public.profiles p
   where p.stars_public and coalesce(p.username, p.handle) is not null
   order by 2 desc, 3 desc, coalesce(p.username, p.handle) asc;
$$;
grant execute on function public.standings() to anon, authenticated;

-- ── 5. bundle previews ───────────────────────────────────────────────────────
-- One picture (a data: URL, ~20–40 KB) per level. Pictures can't be played, so
-- every shopper may see all of them; the level data itself stays behind 007.
create table if not exists public.bundle_previews (
  bundle_id  bigint not null references public.bundles(id) on delete cascade,
  level      int    not null check (level >= 1),
  image      text   not null check (image like 'data:image/%' and char_length(image) < 400000),
  created_at timestamptz not null default now(),
  primary key (bundle_id, level)
);
alter table public.bundle_previews enable row level security;
drop policy if exists "read previews of published bundles" on public.bundle_previews;
create policy "read previews of published bundles" on public.bundle_previews for select
  using (exists (select 1 from public.bundles b where b.id = bundle_id and b.published));
drop policy if exists "admins write previews" on public.bundle_previews;
create policy "admins write previews" on public.bundle_previews for all
  using (public.is_admin()) with check (public.is_admin());
grant select on public.bundle_previews to anon, authenticated;
grant insert, update, delete on public.bundle_previews to authenticated;   -- the policy limits it to admins

-- Level 1 of a published bundle, for the 10-move test. Only level 1, ever.
create or replace function public.bundle_preview_level(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof(data) = 'array' then data -> 0 end
    from public.bundles where id = p_id and published;
$$;
revoke all on function public.bundle_preview_level(bigint) from public;
grant execute on function public.bundle_preview_level(bigint) to anon, authenticated;

-- ── check ────────────────────────────────────────────────────────────────────
-- select * from public.standings() limit 10;
-- select * from public.my_mastery();            -- (signed in as yourself in the app)
