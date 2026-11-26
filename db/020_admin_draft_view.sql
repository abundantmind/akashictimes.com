-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 020: admins can VIEW every Architect's drafts
-- (2026-11-26)  Run in the Supabase SQL editor BEFORE the site ships (the new
-- Admin → Drafts tab calls these; on the old database it shows "run 020").
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--   Jed 2026-11-26: his nephew asked how Jed can see the bundle he's building while
--   Jed is away from Hermes. Drafts (016) are author-only, so until a bundle is
--   SUBMITTED (25 approved levels) nobody else can see it — not even admin.
--   Now an admin can open any draft from Admin → Drafts and Play its levels, from any
--   browser. Architects are told on their Create screen that admins can see drafts.
--
-- ── How ──────────────────────────────────────────────────────────────────────
--   Two SECURITY DEFINER, read-only functions that refuse anyone who isn't an admin.
--   Deliberately NOT a new row-level policy on drafts / draft_files: the editor's sync
--   pulls "every draft I can read" into the device as MY drafts, so a select policy for
--   admins would pour every Architect's drafts into Jed's own bundle list. Functions keep
--   the admin view separate from the sync. There is no admin write path at all.
--
--   §1 admin_list_drafts()        — one row per draft: author, orientation, bundle.json,
--                                   level count, last edit.
--   §2 admin_draft_files(p_draft) — that draft's files (bundle.json + level-0NN.json).
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the list ─────────────────────────────────────────────────────────────
create or replace function public.admin_list_drafts()
returns table (id uuid, author uuid, author_name text, orientation text,
               manifest text, levels int, last_edit timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;
  return query
    select d.id, d.author,
           coalesce(p.username, p.handle, 'unknown architect'),
           d.orientation,
           (select f.body from public.draft_files f where f.draft_id = d.id and f.name = 'bundle.json'),
           (select count(*)::int from public.draft_files f where f.draft_id = d.id and f.name like 'level-%'),
           coalesce((select max(f.edited_at) from public.draft_files f where f.draft_id = d.id), d.updated_at)
      from public.drafts d
      left join public.profiles p on p.id = d.author
     order by 7 desc;
end; $$;
revoke all on function public.admin_list_drafts() from public;
grant execute on function public.admin_list_drafts() to authenticated;

-- ── 2. one draft's files ────────────────────────────────────────────────────
create or replace function public.admin_draft_files(p_draft uuid)
returns table (name text, body text, edited_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;
  return query
    select f.name, f.body, f.edited_at
      from public.draft_files f
     where f.draft_id = p_draft
     order by f.name;
end; $$;
revoke all on function public.admin_draft_files(uuid) from public;
grant execute on function public.admin_draft_files(uuid) to authenticated;

-- ── check ────────────────────────────────────────────────────────────────────
-- select id, author_name, orientation, levels, last_edit from public.admin_list_drafts();
