-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 006: a phone push when a player registers an email
-- (2026-10-25)  Run in the Supabase SQL editor, AFTER 005.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Jed 2026-10-25: "I will want to see notifications immediately when we have new
-- visitors register with an email so they're authenticated online."
-- A trigger on auth.users fires the moment an account's email is CONFIRMED (the
-- player clicked the magic link — authenticated, not just typed an address): a
-- brand-new email sign-up, or an anonymous player attaching an email later. It posts
-- to ntfy (a free push app, no account) through pg_net, so Jed's phone buzzes within
-- seconds. No Edge Function, no password stored anywhere.
--
-- ── Privacy ─────────────────────────────────────────────────────────────────
-- An ntfy topic name works like a password — anyone who knows it can read it. So
-- the push carries the player's in-game NAME and the running total, NEVER their
-- email. The topic itself lives in private.config (a schema no client role can
-- reach), set by hand below — it is NOT in this file, because this repo is public.
--
-- ── Before running ──────────────────────────────────────────────────────────
--   1. Database → Extensions → enable  pg_net
--   2. Phone: install the "ntfy" app → Subscribe to topic → the topic name Claude
--      gave you in chat (server: ntfy.sh)
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── 1. Private settings no client can read ──────────────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (
  key   text primary key,
  value text not null
);
-- RLS ON with NO policies: belt and braces on top of the schema revoke above — no client
-- role can read a row. The trigger still can: it runs as the table's owner, and Postgres
-- does not apply RLS to a table's owner. (Also silences the dashboard's "enable RLS?" prompt.)
alter table private.config enable row level security;

-- ▶ RUN THIS LINE separately with the real topic from chat (keep it out of git):
-- insert into private.config (key, value) values ('ntfy_topic', '<topic from chat>')
--   on conflict (key) do update set value = excluded.value;

-- ── 2. The notifier ─────────────────────────────────────────────────────────
-- security definer: it reads private.config and public.profiles on behalf of the
-- auth system. Any failure is swallowed — a notification must NEVER block a sign-in.
create or replace function private.notify_registration()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  topic text;
  who   text;
  total bigint;
begin
  -- only the moment an email becomes CONFIRMED (insert already confirmed, or null → confirmed)
  if NEW.email is null or NEW.email_confirmed_at is null then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.email_confirmed_at is not null then return NEW; end if;

  -- btrim: a copy-pasted topic can carry spaces or quote marks, which ntfy rejects as
  -- "topic invalid" (it bit the first live test, 2026-10-26)
  select btrim(value, E' \t\r\n"''') into topic from private.config where key = 'ntfy_topic';
  if topic is null or topic = '' then return NEW; end if;       -- not configured yet: stay silent

  select coalesce(nullif(p.username, ''), nullif(p.handle, '')) into who
    from public.profiles p where p.id = NEW.id;
  select count(*) into total from auth.users where email_confirmed_at is not null;

  perform net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic',   topic,
      'title',   'New registered player',
      'message', coalesce(who, 'A new player') || ' just signed in with an email — '
                 || total || ' registered players so far.',
      'tags',    jsonb_build_array('tada')
    )
  );
  return NEW;
exception when others then
  return NEW;                                                    -- never break auth over a push
end; $$;

revoke all on function private.notify_registration() from public, anon, authenticated;

-- ── 3. The trigger ──────────────────────────────────────────────────────────
drop trigger if exists on_auth_user_registered on auth.users;
create trigger on_auth_user_registered
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.notify_registration();

-- ── Test it (after setting the topic) — your phone should buzz ─────────────
-- select net.http_post(url := 'https://ntfy.sh',
--   body := jsonb_build_object('topic', (select btrim(value, E' \t\r\n"''') from private.config where key = 'ntfy_topic'),
--                              'title', 'Akashic test', 'message', 'Sign-up alerts are wired up.'));
