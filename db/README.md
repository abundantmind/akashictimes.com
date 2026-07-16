# Supabase setup — Jed's 10 minutes

The schema and policies are ready ([schema.sql](schema.sql)). What's left needs
the account owner — that's you. Agent takes it from step 5.

## Your part (once)

1. **Create the project** — [supabase.com](https://supabase.com) → sign in with
   GitHub (abundantmind) → New project. Name: `akashicswaps`. Region:
   `Northeast Asia (Seoul)` (희정 and the KR audience are the latency case;
   Hermes doesn't care). Generate a strong DB password and store it — it is
   NOT needed for the site, only for direct Postgres access/pg_dump.
2. **Run the schema** — Dashboard → SQL Editor → paste ALL of `schema.sql` →
   Run. Should end with "Success. No rows returned".
3. **Grab the two publishable values** — Dashboard → Settings → API:
   - `Project URL` (https://xxxx.supabase.co)
   - `anon public` key (long JWT — this one is DESIGNED to ship in the site;
     RLS is the security boundary, not the key)
4. **Hand both to Agent** (paste in session or drop in a file) — that's the
   whole handoff.

## Agent's part (next session, keys in hand)

5. `editor/db.js` — Supabase JS client (CDN ESM import, no build step),
   initialized with the URL + anon key.
6. Auth UI in the site's terminal aesthetic — email magic-link first (no
   password storage anywhere), Google OAuth later if wanted.
7. **localStorage → account merge on first sign-in** (nothing we built is
   thrown away; logged-out play keeps working exactly as today):
   | localStorage key | → | table.column | merge rule |
   |---|---|---|---|
   | `akashicswaps-player` `{n:{s,rec}}` | → | `progress.stars/move_record` | keep MAX stars, MIN non-zero record |
   | `akashicswaps-qualified` | → | `profiles.qualified` | OR |
   | `akashicswaps-path` | → | `profiles.path` | server wins if set, else local |
   | `akashicswaps-lang` | → | `profiles.lang` | local wins (device preference) |
8. "Save Bundle to Cloud" in the editor → `bundles` insert (drafts
   `published=false`); editor home quads start reading real rows — the honest
   empty states from the fake-data purge get their real data.

## Standing cautions (from the 2026-07-11 assessment)

- **Free tier pauses after ~1 week of inactivity.** Options: morning launchd
  job pings a trivial select (keep-alive), or Pro at $25/mo. Decide when it
  first bites.
- Exit door: it's plain Postgres — `pg_dump` and leave anytime.
- Payments (the $1.50 packages) are Stripe later regardless; nothing here
  blocks or prejudges that.
- `credits` minting is client-side for now (same trust level as localStorage
  was). Before money attaches to credits, move minting to an edge function —
  the schema comment marks the exact policy to drop.
