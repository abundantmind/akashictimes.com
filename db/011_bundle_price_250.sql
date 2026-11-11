-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 011: marketplace bundles cost $2.50
-- (2026-11-11)  Run in the Supabase SQL editor, AFTER 010.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Jed 2026-11-11: "90% after card fees at $2.50". At $2 with the Architect keeping
-- 90% of the GROSS, Stripe's 2.9% + 30¢ came out of AkashicTimes' 10% and every
-- sale lost ~16¢. New model: card fees come off the top, then 90% of the rest goes
-- to the Architect. At $2.50: fee ≈ $0.37, Architect ≈ $1.91, AkashicTimes ≈ $0.21.
-- (The split itself is paid out by Stripe Connect, not built yet — this migration
-- only moves the price. The Architect publish fee stays $2.)
--
-- Checkout, the storefront and the Buy button all read bundles.price_cents, so
-- the price lives in exactly two places: what publish_bundle() stamps on new
-- bundles (§1) and the rows already published (§2).
-- Idempotent: a second run changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Publishing stamps $2.50 ───────────────────────────────────────────────
-- Same as 007's publish_bundle, only the price changes (200 → 250).
create or replace function public.publish_bundle(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  update public.bundles
     set published = true, published_at = now(), returned_at = null, review_note = null,
         price_cents = 250,                                   -- $2.50 flat, every marketplace bundle
         updated_at = now()
   where id = p_id and published = false;
  if not found then
    raise exception 'bundle % is not a draft (already published, or no such id)', p_id;
  end if;
end; $$;
revoke all on function public.publish_bundle(bigint) from public;
grant execute on function public.publish_bundle(bigint) to authenticated;  -- the function itself refuses non-admins

-- ── 2. Re-price what is already on sale ─────────────────────────────────────
-- Only PAID bundles at the old $2 (free bundles stay 0). Past purchases keep the
-- amount they were charged (purchases.amount_cents) — nobody is re-billed.
-- Look first:  select id, title, price_cents from public.bundles where published;
update public.bundles
   set price_cents = 250, updated_at = now()
 where published and price_cents = 200;

-- ── Check it ────────────────────────────────────────────────────────────────
-- select title, price_cents from public.storefront();   -- paid bundles show 250
