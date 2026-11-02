-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 010: acorns are Easter eggs now
-- (2026-11-02)  Run in the Supabase SQL editor, AFTER 009.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Jed 2026-11-01: the collectible under the leaves is an EASTER EGG, not an acorn
-- (the acorn + "AC" tile was Township's look). The editor, the shipped levels and
-- every local bundle file were renamed in the same change; this does the same for
-- the level JSON stored in the database — the published "Go With Portrait Flow"
-- (bundle 2) and any draft. Only the word changes: no layout, no goal count, so
-- what a buyer owns plays exactly as before. Purchases are tied to the bundle id,
-- not its contents, so nobody loses anything.
-- The editor still READS "acorn" as egg (legacyEggs), so this is tidiness, not a fix:
-- nothing breaks if it is never run. Run as the SQL editor (it bypasses the
-- authors-touch-drafts-only rule from 004, which is the point — this is admin work).
-- Idempotent: a second run finds nothing to change.
-- ═══════════════════════════════════════════════════════════════════════════

-- Look first: which bundles still say "acorn"?
-- select id, title, published from public.bundles where data::text like '%acorn%';

update public.bundles
   set data = replace(replace(data::text,
                '"item.acorn"', '"item.egg"'),   -- old hand-authored shape: obstacles[].functionalId
                '"acorn"',      '"egg"')::jsonb,  -- collect-N goal: objectives[].item
       updated_at = now()
 where data::text like '%"acorn"%' or data::text like '%"item.acorn"%';

-- Check it: expect 0 rows.
-- select id, title from public.bundles where data::text like '%acorn%';
