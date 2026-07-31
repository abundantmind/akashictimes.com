-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 002: Flow Leaderboard + ★5 throne + star visibility
-- (2026-07-26)  Run ONCE in the Supabase SQL editor, AFTER schema.sql (v1).
-- Fully ADDITIVE and idempotent — safe to run against the live DB. Nothing here
-- drops data; the one constraint swap only WIDENS the stars range (0–3 → 0–5).
--
-- Adds, per Jed's 2026-07-26 rulings:
--   • profiles.stars_public   — opt-in visibility (DEFAULT private) for the board
--   • ★1–★5 star range         — era-2 rewrite (throne = ★5, world-best move record)
--   • level_records            — server-recorded world best per level (the throne)
--   • claim_record()           — the ONLY write path to a throne; server compares
--   • flow_thrones()           — per-level board, anonymized (private holder = 'Anonymous')
--   • flow_standings()         — global vanity board, PUBLIC (opted-in) players only
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. star visibility toggle — opt-in, default PRIVATE (Jed 2026-07-26) ─────
-- A player is invisible on the Flow Leaderboard until they turn this ON.
alter table public.profiles
  add column if not exists stars_public boolean not null default false;

-- ── 2. era-2 stars: ★1–★5 (schema.sql v1 capped at 3) ───────────────────────
-- Existing rows hold 0–3, so widening never violates. ★4 = clean finale,
-- ★5 = sole world-best throne.
alter table public.progress drop constraint if exists progress_stars_check;
alter table public.progress
  add constraint progress_stars_check check (stars between 0 and 5);

-- ── 3. level_records — ONE row per level = the current world best (the throne) ─
-- The move record is a FACT independent of who holds it: if the holder deletes
-- their account the seat vacates (holder → null) but the number stands and must
-- still be beaten. No direct-read/write policies — the functions below are the
-- only doors, so a client can never write a throne it didn't earn.
create table if not exists public.level_records (
  level       int primary key check (level >= 1),
  holder      uuid references public.profiles(id) on delete set null,
  move_record int not null check (move_record > 0),  -- fewer moves = better
  achieved_at timestamptz not null default now()
);
alter table public.level_records enable row level security;
-- (intentionally NO policies: RLS-enabled + no policy = no direct client access;
--  all reads/writes go through the SECURITY DEFINER functions granted below.)

-- ── 4. claim_record() — server-authoritative throne claim ────────────────────
-- The client cannot lie its way onto a throne with a worse score: the server
-- reads the current record and only seats the caller if they genuinely beat it.
-- ANTI-CHEAT (current tier): the caller's OWN progress row must already record
-- this exact score for this level — same trust level as localStorage until real
-- replay verification exists (mirrors the credits-minting caveat in schema.sql).
-- Move minting/claims graduate to a verified edge function when money attaches.
-- USAGE: client writes progress (move_record) FIRST, then calls claim_record().
create or replace function public.claim_record(p_level int, p_moves int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_own     int;
  v_current int;
begin
  if v_uid is null then return false; end if;             -- must be signed in
  if p_moves is null or p_moves <= 0 then return false; end if;

  -- corroborate against the caller's own recorded score for this level
  select move_record into v_own
    from public.progress
    where user_id = v_uid and level = p_level;
  if v_own is null or v_own <> p_moves then return false; end if;

  select move_record into v_current
    from public.level_records where level = p_level;

  if v_current is null then                                -- vacant throne
    insert into public.level_records(level, holder, move_record)
      values (p_level, v_uid, p_moves);
    return true;
  elsif p_moves < v_current then                           -- genuinely better
    update public.level_records
      set holder = v_uid, move_record = p_moves, achieved_at = now()
      where level = p_level;
    return true;
  end if;
  return false;                                            -- didn't beat it
end; $$;

-- ── 5. flow_thrones() — per-level board, anonymized ──────────────────────────
-- Every occupied throne shows, ALWAYS reflecting the true record. A private (or
-- deleted) holder renders as 'Anonymous' but the seat still counts — you must
-- BEAT the record to take it, never out-wait a hidden holder (Jed 2026-07-26).
create or replace function public.flow_thrones()
returns table(level int, display_name text, move_record int, achieved_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select r.level,
         case when p.stars_public then p.username else 'Anonymous' end,
         r.move_record,
         r.achieved_at
  from public.level_records r
  left join public.profiles p on p.id = r.holder
  order by r.level;
$$;

-- ── 6. flow_standings() — global vanity board, PUBLIC players only ───────────
-- A named ranking, so only opted-in players appear (a list of 'Anonymous' rows
-- would rank nothing). Private players still hold thrones — counted by name in
-- flow_thrones as 'Anonymous', just not listed here. Ranked: thrones, then stars.
create or replace function public.flow_standings()
returns table(display_name text, thrones int, total_stars int)
language sql
security definer
set search_path = public
stable
as $$
  select p.username,
         (select count(*)::int from public.level_records r where r.holder = p.id),
         coalesce((select sum(pr.stars)::int from public.progress pr where pr.user_id = p.id), 0)
  from public.profiles p
  where p.stars_public and p.username is not null
  order by 2 desc, 3 desc, p.username asc;
$$;

-- ── 7. grants ────────────────────────────────────────────────────────────────
grant execute on function public.claim_record(int, int) to authenticated;
grant execute on function public.flow_thrones()          to anon, authenticated;
grant execute on function public.flow_standings()        to anon, authenticated;
-- profiles already granted select to anon in schema.sql; the new stars_public
-- column rides that existing grant (column-level grants weren't used there).
