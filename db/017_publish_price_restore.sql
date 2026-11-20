-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 017: publishing stamps $2.50 again
-- (2026-11-20)  Run in the Supabase SQL editor. No site change needed.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--   015 rebuilt publish_bundle from 005's copy to add the family placement, and
--   that copy predates 011's `price_cents = 250`. So every bundle published since
--   015 went live FREE. The first one: Akashic Portrait Window (id 4, Franklin's
--   Tower chapter 2), published 2026-11-20 at $0 — readable by everyone, since
--   the "published and price_cents = 0" policy (007) treats it as a free bundle.
--
-- ── What ─────────────────────────────────────────────────────────────────────
--   §1  publish_bundle = 015's version (admin check, family placement) with the
--       $2.50 stamp put back. Nothing else changes.
--   §2  Re-price the one bundle 015 let through free. Checked 2026-11-20 against the
--       live storefront: Akashic Portrait Window (id 4) is the only published row at 0.
--       Named exactly, so nothing else can be swept up.
-- Idempotent: a second run changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Publish = place in the family + stamp $2.50 ───────────────────────────
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
     set published = true, published_at = now(), returned_at = null, review_note = null,
         price_cents = 250,                                   -- $2.50 flat, every marketplace bundle (011) — RESTORED
         updated_at = now()
   where id = p_id and published = false;
end; $$;
revoke all on function public.publish_bundle(bigint) from public;
grant execute on function public.publish_bundle(bigint) to authenticated;  -- the function itself refuses non-admins

-- ── 2. Re-price what slipped through free ───────────────────────────────────
-- Look first:  select id, title, family_seq, price_cents from public.bundles where published;
update public.bundles
   set price_cents = 250, updated_at = now()
 where id = 4 and title = 'Akashic Portrait Window' and published and price_cents = 0;

-- ── Check it ────────────────────────────────────────────────────────────────
-- select id, title, family_name, family_seq, first_level, price_cents from public.storefront();
--   → every row 250 (Akashic Portrait Window included)
