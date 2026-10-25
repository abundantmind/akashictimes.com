-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 005: Admin review queue + bug reports in the database
-- (2026-10-24)  Run in the Supabase SQL editor, AFTER schema.sql + 002 + 003 + 004.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Publishing a bundle was Jed's hand-flip in this SQL editor, and in-game bug
-- reports went to a Google Form the site can't read. Jed 2026-10-24: "Build
-- version 1 and move bugs into the database." The editor gets an Admin panel
-- (review queue + bugs) — but the PAGE is not the security. Everything an admin
-- can do is enforced HERE:
--   · public.admins lists who is an admin (Jed). Nobody can add themselves.
--   · is_admin() answers "is the caller an admin?" for policies and RPCs.
--   · Publishing / sending back go through SECURITY DEFINER functions that
--     refuse non-admins; migration 004's "authors touch drafts only" stays intact
--     (an author still can never publish their own bundle).
--   · bug_reports: anyone may FILE one (players are often anonymous); only an
--     admin may READ or UPDATE them.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Admins ───────────────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies on purpose: the table is invisible to every client role. Only this
-- SQL editor (service role) and the SECURITY DEFINER function below can read it.

-- Is the CALLER an admin? security definer so it can read public.admins, which no
-- client role can; stable so a policy can call it per row cheaply.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Make Jed the first admin. ▶ CHECK THE EMAIL is the one you sign in with on
-- akashictimes.com before running (it looks the uid up; nothing is inserted if
-- it doesn't match). Add more admins the same way, later, by hand.
insert into public.admins (user_id)
  select id from auth.users where email = 'jed.mitchener@gmail.com'
  on conflict do nothing;

-- ── 2. Review: notes on a bundle, and who/when ─────────────────────────────
alter table public.bundles add column if not exists review_note  text;          -- "sent back" reason the author sees
alter table public.bundles add column if not exists returned_at  timestamptz;   -- set when sent back; null = waiting / published
alter table public.bundles add column if not exists published_at timestamptz;

-- Admins can READ every bundle (other authors' drafts are hidden by "read published
-- or own"). Policies are OR'ed, so this only ADDS visibility for admins.
drop policy if exists "admins read all bundles" on public.bundles;
create policy "admins read all bundles" on public.bundles for select
  using (public.is_admin());

-- Publish a draft. Refuses non-admins; only ever moves draft → published.
create or replace function public.publish_bundle(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  update public.bundles
     set published = true, published_at = now(), returned_at = null, review_note = null, updated_at = now()
   where id = p_id and published = false;
  if not found then
    raise exception 'bundle % is not a draft (already published, or no such id)', p_id;
  end if;
end; $$;

-- Send a draft back to its author with a note (it stays a draft; the author fixes
-- it and submits again — a resubmission is a new row).
create or replace function public.return_bundle(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'say why it is being sent back';
  end if;
  update public.bundles
     set returned_at = now(), review_note = left(p_note, 2000), updated_at = now()
   where id = p_id and published = false;
  if not found then
    raise exception 'bundle % is not a draft', p_id;
  end if;
end; $$;

revoke all on function public.publish_bundle(bigint)      from public;
revoke all on function public.return_bundle(bigint, text) from public;
grant execute on function public.publish_bundle(bigint)      to authenticated;  -- the function itself refuses non-admins
grant execute on function public.return_bundle(bigint, text) to authenticated;

-- ── 3. Bug reports ──────────────────────────────────────────────────────────
create table if not exists public.bug_reports (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  reporter     uuid references auth.users(id) on delete set null,   -- null if not signed in at all
  reporter_tag text check (char_length(reporter_tag) <= 64),         -- the generated reporter id / handle
  description  text not null check (char_length(description) between 1 and 4000),
  bundle       text check (char_length(bundle) <= 120),
  level        text check (char_length(level) <= 40),
  board        jsonb,                                                -- freezeReport() snapshot of the board
  device       text check (char_length(device) <= 400),              -- user agent + viewport
  page_url     text check (char_length(page_url) <= 400),
  status       text not null default 'open' check (status in ('open','fixed','wontfix')),
  admin_note   text check (char_length(admin_note) <= 2000),
  updated_at   timestamptz not null default now(),
  constraint bug_board_size check (board is null or pg_column_size(board) < 200000)
);
alter table public.bug_reports enable row level security;

-- Anyone can FILE a report — as themselves or unsigned — and it always arrives OPEN
-- with no admin note (a reporter can't pre-close their own bug).
drop policy if exists "anyone files a bug" on public.bug_reports;
create policy "anyone files a bug" on public.bug_reports for insert
  with check ((reporter is null or reporter = auth.uid()) and status = 'open' and admin_note is null);

-- Only admins read and triage.
drop policy if exists "admins read bugs"   on public.bug_reports;
drop policy if exists "admins update bugs" on public.bug_reports;
create policy "admins read bugs"   on public.bug_reports for select using (public.is_admin());
create policy "admins update bugs" on public.bug_reports for update
  using (public.is_admin()) with check (public.is_admin());

grant insert                 on public.bug_reports to anon, authenticated;
grant select, update         on public.bug_reports to authenticated;   -- RLS above limits both to admins
grant usage, select on all sequences in schema public to anon, authenticated;

-- ── Check it worked (run after) ─────────────────────────────────────────────
-- select * from public.admins;                     -- one row: your uid
-- select id, title, published, returned_at from public.bundles where published = false;
