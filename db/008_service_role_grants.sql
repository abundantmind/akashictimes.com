-- ═══════════════════════════════════════════════════════════════════════════
-- AkashicSwaps — migration 008: give the server's own role its table grants
-- (2026-10-28)  Run in the Supabase SQL editor, AFTER 007.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The `stripe` Edge Function reads bundles and writes purchases as service_role
-- (the project's secret key). Its self-check came back 403 "permission denied":
-- this project never got Supabase's usual default grants — schema.sql already
-- found the same hole for anon/authenticated on 2026-07-22. service_role skips
-- RLS, but it still needs a table GRANT to reach a table at all.
-- service_role is the server-only role (never in the browser), so it gets everything.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- and for tables/sequences created by future migrations
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
