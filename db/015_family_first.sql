-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 015: family first
-- (2026-11-14)  Run in the Supabase SQL editor, AFTER 013 + 014. Run it BEFORE the
-- site version that sends family claims ships, or every Submit fails with
-- "column req_family does not exist".
--
-- ── Why (Jed 2026-11-14) ─────────────────────────────────────────────────────
--   "When an architect creates their first Bundle, they should consider the Family
--   (Game Path Name) before the Bundle name." The editor's Create box now asks for
--   the Family first. Until now a family was set only here, by hand, after publishing.
--
-- ── How it works ─────────────────────────────────────────────────────────────
--   · Submit carries a family CLAIM: req_family (name), req_family_seq (chapter),
--     req_orientation. A claim is a request, not a placement.
--   · Publish (the Admin button) acts on it:
--       - no such family yet → it's created, OWNED by the bundle's author, in the
--         bundle's orientation, and the bundle must be chapter 1;
--       - the family exists → the author must own it (house families, owner null,
--         take only an admin's bundles), the orientation must match, and the chapter
--         must be the NEXT one (no gaps, no doubles);
--       - first_level = (chapter − 1) × 25 + 1.
--     A claim that fails stops the Publish with a message saying why; send it back.
--   · One owner per family: an Architect's game path is theirs alone. Ground Zero and
--     Franklin's Tower stay house families (owner null).
--   · Authors can no longer set family_id / family_seq / first_level themselves
--     (013 meant that, but the insert/update policies didn't say it).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Families get an owner ────────────────────────────────────────────────
alter table public.families add column if not exists owner uuid references auth.users(id) on delete set null;
-- null = a house family (Ground Zero, Franklin's Tower): only admins add chapters.

-- ── 2. The claim a submission carries ───────────────────────────────────────
alter table public.bundles add column if not exists req_family      text check (char_length(req_family) between 1 and 60);
alter table public.bundles add column if not exists req_family_seq  int  check (req_family_seq >= 1);
alter table public.bundles add column if not exists req_orientation text check (req_orientation in ('landscape', 'portrait'));

-- ── 3. Placement is Publish's job, never the author's ──────────────────────
drop policy if exists "insert own drafts" on public.bundles;
create policy "insert own drafts" on public.bundles for insert
  with check (author = auth.uid() and published = false
              and family_id is null and family_seq is null and first_level = 1);
drop policy if exists "update own drafts" on public.bundles;
create policy "update own drafts" on public.bundles for update
  using      (author = auth.uid() and published = false)
  with check (author = auth.uid() and published = false
              and family_id is null and family_seq is null and first_level = 1);

-- ── 4. Publish places the bundle in its claimed family ─────────────────────
-- Same as 005's publish_bundle (admin only, draft → published) plus the placement.
-- A bundle already placed by hand (family_id set) is left where it is.
create or replace function public.publish_bundle(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.bundles%rowtype;
  f public.families%rowtype;
  last_seq int;
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  select * into b from public.bundles where id = p_id and published = false for update;
  if not found then
    raise exception 'bundle % is not a draft (already published, or no such id)', p_id;
  end if;

  if b.req_family is not null and b.family_id is null then
    select * into f from public.families where lower(name) = lower(btrim(b.req_family));
    if not found then
      -- a brand-new family: starts at chapter 1, belongs to this author
      if coalesce(b.req_family_seq, 1) <> 1 then
        raise exception 'family "%" doesn''t exist yet, so this bundle must be chapter 1 (it says %)', b.req_family, b.req_family_seq;
      end if;
      if b.req_orientation is null then
        raise exception 'a new family needs an orientation; this submission has none';
      end if;
      insert into public.families (name, orientation, native_head, owner)
      values (btrim(b.req_family), b.req_orientation, false, b.author)
      returning * into f;
    else
      -- an existing family: the author's own (house families take admins' bundles only)
      if f.owner is distinct from b.author
         and not (f.owner is null and exists (select 1 from public.admins where user_id = b.author)) then
        raise exception 'family "%" belongs to another Architect', f.name;
      end if;
      if b.req_orientation is not null and b.req_orientation <> f.orientation then
        raise exception 'family "%" is %, this bundle is %', f.name, f.orientation, b.req_orientation;
      end if;
    end if;
    -- chapters run straight through: the next one, never a gap or a double
    select coalesce(max(family_seq), case when f.native_head then 1 else 0 end) into last_seq
      from public.bundles where family_id = f.id and published;
    if coalesce(b.req_family_seq, 1) <> last_seq + 1 then
      raise exception 'family "%" is ready for chapter %, this bundle says chapter %', f.name, last_seq + 1, coalesce(b.req_family_seq, 1);
    end if;
    update public.bundles
       set family_id = f.id, family_seq = last_seq + 1, first_level = last_seq * 25 + 1
     where id = p_id;
  end if;

  update public.bundles
     set published = true, published_at = now(), returned_at = null, review_note = null, updated_at = now()
   where id = p_id and published = false;
end; $$;
revoke all on function public.publish_bundle(bigint) from public;
grant execute on function public.publish_bundle(bigint) to authenticated;  -- the function itself refuses non-admins

-- ── Check it ────────────────────────────────────────────────────────────────
-- select id, name, orientation, owner from public.families;
--   → Ground Zero and Franklin's Tower with owner null
-- After publishing a bundle with a claim:
-- select id, title, family_name, family_seq, first_level, orientation from public.storefront();
