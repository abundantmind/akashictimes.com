-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 021: shoppers can actually SEE the preview pictures
-- (2026-11-28)  Run in the Supabase SQL editor. No site change needed — the store
-- sheet starts showing the pictures the moment this runs.
--
-- ── The bug ─────────────────────────────────────────────────────────────────
--   Jed 2026-11-28, testing the store sheet in an incognito window: "Pictures of
--   every level are on the way" on Akashic Window, though he'd made the pictures
--   twice. They WERE saved (an admin reads all 25 back). But 018's read rule asked
--   "is this bundle published?" by looking in public.bundles — and since 007 a
--   shopper can't see a PAID bundle's row there (that's what keeps its levels
--   private). So for every shopper the check found no bundle and hid every picture.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
--   Ask through a SECURITY DEFINER function that answers only "published: yes/no"
--   for one bundle id. It hands out no level data, title or anything else, so the
--   privacy 007 set up is untouched; the pictures were always meant to be public.
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- Is this bundle published? (true/false only — nothing else about it)
create or replace function public.bundle_is_published(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bundles b where b.id = p_id and b.published)
$$;
revoke all on function public.bundle_is_published(bigint) from public;
grant execute on function public.bundle_is_published(bigint) to anon, authenticated;

-- Same rule as 018 (pictures of PUBLISHED bundles, readable by anyone), now asked
-- through the function so a shopper's own view of public.bundles doesn't matter.
drop policy if exists "read previews of published bundles" on public.bundle_previews;
create policy "read previews of published bundles" on public.bundle_previews for select
  using (public.bundle_is_published(bundle_id));

-- ── check (as a shopper: the site's incognito store sheet shows the grid) ───
-- select bundle_id, count(*) from public.bundle_previews group by 1;
