-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 004: published bundles are final
-- (2026-09-30)  Run in the Supabase SQL editor, AFTER schema.sql + 002 + 003.
-- No data changes — policies only.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- schema.sql's "update own bundles" / "delete own bundles" let an author touch
-- ANY row they wrote: rewrite the levels of a bundle players already BOUGHT,
-- flip published=true on their own draft (skipping Jed's review), or delete a
-- published bundle out from under its buyers. Published = frozen: an author
-- edits only DRAFTS; changing a published bundle means submitting a new draft
-- (a new version) for review. Publishing stays Jed's hand-flip in the SQL
-- editor (the service role bypasses RLS).
--
-- STATUS: §1 + §2 were RUN by Jed 2026-09-30. §3 (insert) is NEW — run it too:
-- without it an author can INSERT a row with published=true directly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. update: own DRAFTS only, and an update can never publish ────────────
drop policy if exists "update own bundles" on public.bundles;
drop policy if exists "update own drafts"  on public.bundles;
create policy "update own drafts" on public.bundles for update
  using      (author = auth.uid() and published = false)
  with check (author = auth.uid() and published = false);

-- ── 2. delete: own DRAFTS only — a published bundle never leaves its buyers ─
drop policy if exists "delete own bundles" on public.bundles;
drop policy if exists "delete own drafts"  on public.bundles;
create policy "delete own drafts" on public.bundles for delete
  using (author = auth.uid() and published = false);

-- ── 3. insert: a submission always arrives as a DRAFT ───────────────────────
drop policy if exists "insert own bundles" on public.bundles;
drop policy if exists "insert own drafts"  on public.bundles;
create policy "insert own drafts" on public.bundles for insert
  with check (author = auth.uid() and published = false);
