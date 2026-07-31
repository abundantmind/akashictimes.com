# MARKETPLACE-VAULT — the platform spine

*North star, written 2026-07-30 after a 40,000-ft course-correction. This doc exists
so the pivot below stops getting out-prioritized by the next shiny level.*

## The catch we caught
We were shipping **content** (hand-authored levels, per-level bug fixes) while
describing a **platform** (a marketplace where strangers build and sell bundles).
Doing artisan work while planning a factory is why the build *felt* slow — the
sessions weren't building the thing the vision needs. Correcting: **flip the arc
from content-authoring to platform-spine.**

Two tracks, never to be conflated again:
- **Content** — Jed hand-builds the 25th level. Low marginal leverage now.
- **Spine** — serializer → save → roles → publish/vault → storefront. The flywheel
  that lets *others* build the 26th through the 12,000th and pay for the privilege.

## What's true today (grounded, not aspirational)
- Editor (the sandbox) paints all 6 layers and plays levels. **Works.**
- Magic-link auth is LIVE. Jed = editor #1.
- `bundles` table exists: `data jsonb` (the level payload), `author` FK (ownership
  pointer), `published` bool, RLS as the write boundary. **Good bones.**
- `credits` is a working append-only ledger — the pattern the publications registry
  will copy.

## What's missing (the honest gap)
- **Serializer** — board[][] → canonical JSON. Barely exists (objectives slice only).
  This is the chokepoint: durable save, uniqueness hashing, and `bundles.data` ALL
  depend on it. It's been sitting *behind* level-authoring. That's backwards.
- **Durable save** to the architect's local HD (a browser can't silently write to
  disk — needs File System Access API into `editor/levels/`, or download).
- **Architect role + free-week trial** — today "architect" = anyone who clicks the
  path button. No DB role, no trial clock.
- **Publish RPC** — uniqueness check + ownership record + publish immutability.
  Server-authoritative (a `security definer` RPC), because RLS alone can't enforce
  dedup or "insert once, never mutate after publish."
- **Storefront + purchase + payouts.**

## The honest limit on "guarantee uniqueness"
- **Exact-duplicate**: guaranteeable and cheap — SHA-256 of the canonical bundle +
  a `unique` index. Re-publish the same bytes → the DB rejects it.
- **Near-duplicate / plagiarism** (tweak one gem, republish): a **similarity
  heuristic**, never a guarantee. "Guarantee" is a word backed by contract law; we
  don't spend it on something we can't deliver.

## Digital ownership
`bundles.author` + an append-only **`publications`** registry
`(content_hash, author, published_at)`. First-to-publish-a-hash owns it. Mirrors the
credits ledger: append-only, never revoked. On publish the local copy locks;
further edits become a new version, never an in-place mutation of a published row.

## Why HTML-in-a-browser stays
Not the bottleneck — the right call. Zero-install across Android/iOS/Windows/WebGL,
no app-store 30%. The engine runs on each visitor's own device, so **play scales at
near-zero server cost.** The only server-heavy operation — the uniqueness check —
happens at publish (rare), not play (constant). Rewriting to native now would be the
actual catastrophe: months to re-derive an engine we already have.

## Wizard-of-Oz the opening
With dozens of publishers, not thousands, the first bundles get **eyeballed and
approved by hand** while the automated scorer is built behind the curtain. The
flywheel turns at ~10 architects; the full uniqueness engine isn't needed until
~1,000. Don't let the endgame's automation block the opening's motion.

## The milestone
**"A stranger builds a bundle, we verify it's theirs, it lists."**
Money can lag. Ownership can't.

## The arc (four focused sessions, each a load-bearing pillar)
1. **Serializer** + round-trip-verify the 25 (proves it, and the clean re-serialized
   JSONs *are* the seed of Bundle 1 "Go with the Flow").
2. **Durable local save** (File System Access → `editor/levels/`).
3. **Publish RPC + vault schema** (`content_hash`, unique index, `publications`,
   immutability trigger) — folds into the held `db/002`.
4. **Storefront.** Payment execution, Stripe, and the ToS/"guarantee" liability are
   **Jed's** — by law and by the agent's hard limits.

## The brand thesis (why any of this is worth owning)
The subreddit intro video: a sad emoji says *"You almost won! Wanna try again?"* and
offers *"5 more moves for $1"* … and *"Cancel."* It satirizes the lives/move-limit
extortion every big match-3 runs. Akashic Swaps has **no lives and no move limit** —
so the Cancel button is the punchline. The marketplace is the same ethos: the people
who *build* the game are the ones who get paid, not milked.
