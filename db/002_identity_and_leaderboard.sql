-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 002: Identity durability + Leaderboard standings
-- (2026-08-14)  SUPERSEDES the never-run db/002_flow_leaderboard.sql.
-- Run ONCE in the Supabase SQL editor, AFTER schema.sql (v1). Fully additive
-- and idempotent — safe to re-run; nothing here drops data or alters a column.
--
-- ── COMPANION DASHBOARD STEP (NOT SQL — do this too) ────────────────────────
-- Enable  Auth → Providers → Anonymous sign-ins.  Then every visitor gets a real
-- auth.users row → the existing handle_new_user() trigger mints their profiles
-- row → their generated handle (identity.js) becomes a FIRST-CLASS server identity
-- that holds progress + a leaderboard seat WITHOUT an email (Jed 2026-08-14).
-- If that player later magic-links an email, Supabase KEEPS THE SAME uid, so their
-- stars/handle carry over automatically — no merge path needed.
--
-- ── Model (Jed 2026-08-14) ──────────────────────────────────────────────────
-- Stars stay ★0–★3 (industry standard — schema.sql v1 already caps at 3, so this
-- migration does NOT touch that constraint). Mastery = 3★ on all 25 = 75/75 =
-- "Leaderboard Access". MANY players can hold 75/75 and stand side by side — there
-- is NO single-seat world-record "throne" (the ★4/★5 one-winner idea is dropped as
-- a bad incentive). So this migration is deliberately SMALL:
--   • profiles.handle        — server copy of the generated anon handle
--   • profiles.stars_public  — opt-in board visibility (DEFAULT private)
--   • standings()            — global leaderboard: opted-in players by stars, reach
-- REMOVED vs the old 002: level_records, claim_record(), flow_thrones(), the ★→5
-- widen. "flow" is gone from every name — it was Bundle-1 ("Go with the Flow")
-- branding and means nothing once other bundles exist. "Current level attained"
-- is DERIVED (max(level) in standings), not a stored column — no dual-write.
-- engineVersion + per-level publish-status stay OUT — they're marketplace-layer.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. profiles.handle — the server copy of identity.js's generated handle ───
-- Two-tier identity MIRRORS the client (identity.js):
--   HANDLE   = auto-minted 'wicked-jumping-llama' — NON-unique (cosmetic collisions
--              are fine at ~13k combos; dedup is not worth a constraint here)
--   USERNAME = the chosen override (schema.sql, already UNIQUE, 3–24 chars)
-- Display everywhere = username ?? handle. Kept as a SEPARATE column so the unique
-- username constraint can never reject a colliding handle. The client writes this
-- up right after anonymous sign-in (auth.js wiring, not part of this SQL).
alter table public.profiles
  add column if not exists handle text
    check (handle is null or char_length(handle) between 3 and 40);

-- ── 2. profiles.stars_public — opt-in board visibility, default PRIVATE ──────
-- (Jed 2026-07-26; /privacy depends on this default.) A player — anon handle or
-- named — is invisible on the leaderboard until they turn this ON.
alter table public.profiles
  add column if not exists stars_public boolean not null default false;

-- ── 3. standings() — the global leaderboard, PUBLIC (opted-in) players only ──
-- Unlocked in the UI at 75/75 ("Leaderboard Access"); the function itself is open
-- so the board can also be previewed. Two axes: total stars (sum across every
-- bundle's levels — grows meaningful as bundles multiply) and REACH (current level
-- attained, the sequential-progression axis, derived as max level). Only opted-in
-- players with a display name appear; private players simply aren't listed.
-- Display name = username ?? handle (an opted-in anon player shows their handle).
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
            from public.progress pr where pr.user_id = p.id), 0)
  from public.profiles p
  where p.stars_public and coalesce(p.username, p.handle) is not null
  order by 2 desc, 3 desc, coalesce(p.username, p.handle) asc;
$$;

-- ── 4. grants ────────────────────────────────────────────────────────────────
grant execute on function public.standings() to anon, authenticated;
-- profiles already grants select to anon in schema.sql; the new handle +
-- stars_public columns ride that existing table grant (no column-level grants used).
-- authenticated already has update on profiles (schema.sql) → anon-signed-in users
-- can write their own handle/username/stars_public via the "update own profile" policy.
