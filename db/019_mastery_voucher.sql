-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 019: a free Akashic Window for the first 25 Masters
-- (2026-11-26)  Run in the Supabase SQL editor BEFORE the site ships (the new
-- page calls these functions; on the old database the claim button just stays hidden).
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--   Jed 2026-11-26: "Free Window, first 25 Masters." A reward for 75/75 on Akashic
--   Flow that SEEDS THE LEADERBOARD: claiming the voucher puts the player on the
--   public board (the claim button says so). Akashic Window is Jed's own bundle,
--   so the gift costs nothing and no Architect share is owed.
--
-- ── What ─────────────────────────────────────────────────────────────────────
--   §1  purchases.kind — 'stripe' (a sale) or 'voucher' (a gift). A voucher row is
--       $0, author_cents 0, author_id null → payouts (012) never see it.
--   §2  voucher_info() — slots left + where the caller stands (claimed / eligible /
--       too_late / none). Read-only; the page uses it to show or hide the button.
--   §3  claim_mastery_voucher() — checks mastery HERE (record_mastery, from
--       best_stars), checks the player is one of the first 25 Masters, turns their
--       board visibility on, and writes the voucher purchase. Idempotent.
--
-- ── Rules ───────────────────────────────────────────────────────────────────
--   · "First 25" = the first 25 NON-ADMIN players by profiles.mastered_at. Admins
--     already own every bundle, so they don't use up a slot. (The board's
--     "Master #N" still counts everyone.) A Master who never claims keeps their
--     slot; it doesn't pass to #26.
--   · Email sign-in required, same as buying: an anonymous session's purchase
--     would die with the browser.
--   · A player who already owns the Window gets 'already_owned' (nothing written).
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. purchases.kind ───────────────────────────────────────────────────────
alter table public.purchases
  add column if not exists kind text not null default 'stripe' check (kind in ('stripe', 'voucher'));

-- How many voucher slots there are. One place to change it.
create or replace function public.voucher_cap()
returns int language sql immutable as $$ select 25 $$;

-- ── 2. where things stand (for the page) ────────────────────────────────────
-- {slots_left, mine}. mine, for the caller:
--   claimed   — they have the voucher already
--   eligible  — a Master inside the first 25 who hasn't claimed (button shows)
--   too_late  — a Master past #25
--   none      — not signed in / not a Master yet / an admin
-- Read-only: it never stamps mastery (the claim does that).
create or replace function public.voucher_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_at   timestamptz;
  v_rank int;
  v_left int;
  v_mine text := 'none';
begin
  select greatest(0, public.voucher_cap() - count(*)::int) into v_left
    from public.profiles p
   where p.mastered_at is not null
     and not exists (select 1 from public.admins a where a.user_id = p.id);
  if v_uid is not null and not public.is_admin() then
    if exists (select 1 from public.purchases where user_id = v_uid and kind = 'voucher') then
      v_mine := 'claimed';
    else
      select mastered_at into v_at from public.profiles where id = v_uid;
      if v_at is not null then
        select count(*)::int into v_rank
          from public.profiles q
         where q.mastered_at <= v_at
           and not exists (select 1 from public.admins a where a.user_id = q.id);
        v_mine := case when v_rank <= public.voucher_cap() then 'eligible' else 'too_late' end;
      end if;
    end if;
  end if;
  return jsonb_build_object('slots_left', v_left, 'mine', v_mine);
end; $$;
revoke all on function public.voucher_info() from public;
grant execute on function public.voucher_info() to anon, authenticated;

-- ── 3. the claim ────────────────────────────────────────────────────────────
-- Returns jsonb {status, rank?, bundle_id?}. status is one of:
--   granted · already_owned · sign_in · email_first · not_mastered · admin ·
--   too_late (rank > 25) · no_window (Akashic Window isn't published)
create or replace function public.claim_mastery_voucher()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_at     timestamptz;
  v_rank   int;
  v_window bigint;
  v_n      int;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'sign_in');
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('status', 'email_first');
  end if;
  if public.is_admin() then
    return jsonb_build_object('status', 'admin');
  end if;

  -- Stamp mastery if the cloud's best stars just reached 75 (018), then read it.
  perform 1 from public.record_mastery();
  select p.mastered_at into v_at from public.profiles p where p.id = v_uid;
  if v_at is null then
    return jsonb_build_object('status', 'not_mastered');
  end if;

  -- Place among non-admin Masters (earliest first).
  select count(*)::int into v_rank
    from public.profiles q
   where q.mastered_at <= v_at
     and not exists (select 1 from public.admins a where a.user_id = q.id);
  if v_rank > public.voucher_cap() then
    return jsonb_build_object('status', 'too_late', 'rank', v_rank);
  end if;

  -- Akashic Window = chapter 2 of the native family (Ground Zero).
  select b.id into v_window
    from public.bundles b
    join public.families f on f.id = b.family_id
   where f.native_head and b.family_seq = 2 and b.published
   limit 1;
  if v_window is null then
    return jsonb_build_object('status', 'no_window');
  end if;

  -- Claiming = joining the public board (that's the point of the reward).
  update public.profiles set stars_public = true where id = v_uid;

  -- The gift. stripe_session_id is the purchases idempotency key, so one voucher per
  -- player ever; (user_id, bundle_id) stops it if they already bought the Window.
  insert into public.purchases
         (user_id, bundle_id, amount_cents, currency, stripe_session_id, livemode,
          author_id, fee_cents, author_cents, kind)
  values (v_uid, v_window, 0, 'usd', 'voucher:mastery:' || v_uid, true,
          null, 0, 0, 'voucher')
  on conflict do nothing;
  get diagnostics v_n = row_count;

  return jsonb_build_object('status', case when v_n > 0 then 'granted' else 'already_owned' end,
                            'rank', v_rank, 'bundle_id', v_window);
end; $$;
revoke all on function public.claim_mastery_voucher() from public;
grant execute on function public.claim_mastery_voucher() to authenticated;

-- ── check ────────────────────────────────────────────────────────────────────
-- select public.voucher_info();
-- select user_id, bundle_id, kind, stripe_session_id from public.purchases where kind = 'voucher';
