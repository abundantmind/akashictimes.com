-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 016: cloud drafts
-- (2026-11-15)  Run in the Supabase SQL editor, AFTER 015. Run it BEFORE the site
-- version with cloud drafts ships, or a signed-in Architect's drafts stay on their
-- device only (the editor keeps working; it just can't sync).
--
-- ── Why (Jed 2026-11-15: "Everything is moving towards the cloud.") ──────────
--   Until now a bundle being built was a FOLDER on the Architect's computer, written
--   through a browser feature only desktop Chrome/Edge have. An iPad or Android tablet
--   couldn't build at all. Now the Architect's ACCOUNT is the home: an Architect who
--   watches a clip on a long flight with only an iPad can qualify, pick a family, and
--   build their first level. Folders become Export / Import only.
--
-- ── How it works ─────────────────────────────────────────────────────────────
--   · A draft bundle = a set of named text files, exactly what the folder held:
--     bundle.json (name, family, approvals, submissions) + level-0NN.json. Keeping the
--     FILES (not a re-modelled schema) means the editor's save / approve / submit code
--     is unchanged, approvals (SHA-256 of a file's text) survive the move byte-for-byte,
--     and Export writes back the same folder an AI or the SDK would produce.
--   · The editor saves every edit on the device FIRST (IndexedDB), then sends it here
--     when there's a connection. Offline on a plane = keep building; it syncs on landing.
--   · drafts.id is a UUID made ON THE DEVICE, so a draft can be born offline.
--   · Two devices editing the same level: the later EDIT wins (edited_at, set by the
--     device at the moment of the edit), never the later upload. save_draft_file
--     enforces it.
--   · Private: only the author reads or writes their drafts. Submitting still copies
--     the levels into public.bundles (unchanged), which is what Jed reviews.
--   · Limits so free storage can't be farmed: 200 drafts per author, 80 files per
--     draft, 200 KB per file (a level is ~2–5 KB).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The tables ───────────────────────────────────────────────────────────
create table if not exists public.drafts (
  id          uuid primary key,                       -- minted by the device (offline-safe)
  author      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  orientation text not null check (orientation in ('landscape', 'portrait')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists drafts_author_idx on public.drafts(author);

create table if not exists public.draft_files (
  draft_id   uuid not null references public.drafts(id) on delete cascade,
  name       text not null check (name ~ '^(bundle\.json|level-[0-9]{3,4}\.json)$'),
  body       text not null check (char_length(body) <= 200000),
  edited_at  timestamptz not null,                    -- when the Architect made the edit (device clock)
  updated_at timestamptz not null default now(),      -- when it reached the server (incremental pulls)
  primary key (draft_id, name)
);
create index if not exists draft_files_updated_idx on public.draft_files(updated_at);

-- ── 2. Only the author, ever ────────────────────────────────────────────────
alter table public.drafts      enable row level security;
alter table public.draft_files enable row level security;

drop policy if exists "own drafts" on public.drafts;
create policy "own drafts" on public.drafts for all
  using      (author = auth.uid())
  with check (author = auth.uid());

drop policy if exists "own draft files" on public.draft_files;
create policy "own draft files" on public.draft_files for all
  using      (exists (select 1 from public.drafts d where d.id = draft_id and d.author = auth.uid()))
  with check (exists (select 1 from public.drafts d where d.id = draft_id and d.author = auth.uid()));

grant select, insert, update, delete on public.drafts, public.draft_files to authenticated;

-- ── 3. Limits (counted in the database, not trusted to the page) ────────────
create or replace function public.drafts_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'drafts' then
    if (select count(*) from public.drafts where author = new.author) >= 200 then
      raise exception 'draft limit reached (200 per Architect)';
    end if;
  else
    if (select count(*) from public.draft_files where draft_id = new.draft_id) >= 80 then
      raise exception 'file limit reached (80 per draft)';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists drafts_limit on public.drafts;
create trigger drafts_limit before insert on public.drafts
  for each row execute function public.drafts_limits();
drop trigger if exists draft_files_limit on public.draft_files;
create trigger draft_files_limit before insert on public.draft_files
  for each row execute function public.drafts_limits();

drop trigger if exists drafts_touch on public.drafts;
create trigger drafts_touch before update on public.drafts
  for each row execute function public.touch_updated_at();

-- ── 4. Save one file: the later EDIT wins ───────────────────────────────────
-- security INVOKER: the row-level policies above still decide whose draft it is.
-- An older edit arriving late (a tablet that was offline) never overwrites a newer
-- one; it returns false and the device takes the newer copy on its next pull.
create or replace function public.save_draft_file(p_draft uuid, p_name text, p_body text, p_edited_at timestamptz)
returns boolean language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  insert into public.draft_files (draft_id, name, body, edited_at)
  values (p_draft, p_name, p_body, p_edited_at)
  on conflict (draft_id, name) do update
     set body = excluded.body, edited_at = excluded.edited_at, updated_at = now()
   where public.draft_files.edited_at <= excluded.edited_at;
  get diagnostics n = row_count;
  if n > 0 then update public.drafts set updated_at = now() where id = p_draft; end if;
  return n > 0;
end; $$;
revoke all on function public.save_draft_file(uuid, text, text, timestamptz) from public;
grant execute on function public.save_draft_file(uuid, text, text, timestamptz) to authenticated;

-- ── Check it ────────────────────────────────────────────────────────────────
-- select d.id, d.orientation, count(f.*) files, max(f.updated_at) last_sync
--   from public.drafts d left join public.draft_files f on f.draft_id = d.id
--  group by d.id order by last_sync desc nulls last;
