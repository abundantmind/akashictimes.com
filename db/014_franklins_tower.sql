-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 014: the Portrait family "Franklin's Tower"
-- (2026-11-13)  Run in the Supabase SQL editor, AFTER 013 (needs public.families).
--
-- Jed 2026-11-13: the Portrait twin of Ground Zero is FRANKLIN'S TOWER.
--   chapter 1 = Go With Portrait Flow (public.bundles id 2), levels 1–25
--   chapter 2 = Akashic Portrait Window (built by Fable 2026-11-13, not published yet),
--               levels 26–50. When it's published, place it with the §3 statement.
-- Portrait only: nothing in Ground Zero (Landscape) unlocks it, or the reverse.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The family ───────────────────────────────────────────────────────────
-- native_head = false: chapter 1 is a real bundle row, not the built-in bundle 0.
insert into public.families (name, orientation, native_head)
values ('Franklin''s Tower', 'portrait', false)
on conflict (name) do nothing;

-- ── 2. Go With Portrait Flow = chapter 1 ────────────────────────────────────
update public.bundles
   set family_id   = (select id from public.families where name = 'Franklin''s Tower'),
       family_seq  = 1,
       first_level = 1
 where id = 2 and title = 'Go With Portrait Flow';

-- ── 3. LATER, once Akashic Portrait Window is published (fill in its id) ────
-- update public.bundles
--    set family_id   = (select id from public.families where name = 'Franklin''s Tower'),
--        family_seq  = 2,
--        first_level = 26
--  where id = <new id> and title = 'Akashic Portrait Window';

-- ── Check it ────────────────────────────────────────────────────────────────
-- select id, title, family_name, family_seq, first_level, orientation from public.storefront();
--   → Go With Portrait Flow: Franklin's Tower · 1 · 1 · portrait
