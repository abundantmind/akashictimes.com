# Power-Up Combo Spec
**Status:** APPROVED + IMPLEMENTED 2026-07-08 (Jed greenlit by scheduling the build: "Today's goals: … PU Combos"). All 10 combos live in bundle levels; PU⇄PU still bounces in the Qualifying level per §Resolved-3.
**Source:** Jed's direct answers, 2026-07-08 session. No silent inferences — open items are flagged.

**Implementation notes (2026-07-08):**
- #10 Ball×Ball shipped GEMS-ONLY (obstacle HP mechanics don't exist yet — spec's "Harder" flag).
- #3 Fly×Ball: spawned Dragonflies get a RANDOM H/V axis each (spec silent on axis — assumption flagged for Jed).
- All combos verified on L2 through the real tap path: choice flows, board integrity, exact clear counts (Fly×Fly = row+col−1 confirmed).

---

## Trigger model (all combos)

- Trigger: player swaps two power-ups (the gesture that currently bounces).
- **Origin = the swap DESTINATION cell** (where the dragged PU lands), never the source.
- Combos consume BOTH power-ups.
- Chain rule unchanged: anything a combo blast catches detonates through the existing queue.

## The Ball family rule (applies to 3, 5, 6)

Ball + any non-Ball, player-activated:
1. Vibe opens — player picks a color (same interaction as solo Ball choosing).
2. Every gem of the chosen color **becomes the partner power-up**.
3. All spawned power-ups then detonate.

---

## The 10 combos

| # | Combo | Behavior (Jed's words, tightened) |
|---|-------|-----------------------------------|
| 1 | **Fly × Hopper** | Hopper jump flow first: vibe → player picks destination → Hopper jumps. Then the Fly fires FROM the Hopper's destination cell (line clear along the Fly's axis). |
| 2 | **Fly × Scarab** | Scarab multiplies the Fly: **3 rows or 3 columns** cleared, centered on the swap destination. Instant, no targeting. |
| 3 | **Fly × Ball** | Ball family rule: vibe color pick → all gems of that color become Dragonflies → all fire. |
| 4 | **Hopper × Scarab** | Hopper jumps (vibe → player picks destination), **3×3 Scarab blast at the landing cell**. |
| 5 | **Hopper × Ball** | Jed's favorite. Ball family rule: chosen color's gems all become Grasshoppers → each detonates in place with **auto-picked targets** (goal-oriented, like chain-caught hoppers). *Decided 2026-07-08: auto — per-hopper vibes made UX too complicated; Jed reserves the right to revisit.* |
| 6 | **Scarab × Ball** | Ball family rule: chosen color's gems all become Scarabs → all detonate (3×3 each). |
| 7 | **Fly × Fly** | Cross: full row + full column from the swap destination. |
| 8 | **Hopper × Hopper** | 3 Grasshoppers are created and sent to **auto-picked destinations** (goal-oriented); corners at the origin also clear — so the origin effect equals a Scarab blast (3×3) at the swap point, plus 3 jumps. *Decided 2026-07-08: auto; Jed reserves the right to revisit.* |
| 9 | **Scarab × Scarab** | One bigger blast: **5×5** at the swap destination. |
| 10 | **Ball × Ball** | **One hit point to the entire board**: clears all gems; reduces the HP counter on every obstacle (chains/crates/leaves) by 1. |

---

## Resolved decisions (2026-07-08)

1. **#8 Hopper×Hopper destinations: AUTO-PICKED** (goal-oriented). Right to revisit reserved.
2. **#5 Hopper×Ball targets: AUTO-PICKED.** Per-hopper vibes = UX too complicated. Right to revisit reserved.
3. **Combos are NOT active in the Qualifying level (Initial Visit).** PU⇄PU keeps bouncing in `entranceMode` even after combos ship. Combos are EARNED: they get their own future qualifying level (solo mastery first, combo training later). Also avoids one combo swap ticking two Fire goals at once.
4. Approach: iterate, test, go forward.

## Standing assumptions (correct if wrong)

- **#1 Fly×Hopper:** the Fly keeps its own H/V axis when firing from the landing cell.
- **#2 Fly×Scarab:** 3 lines along the Fly's own axis (DFH → 3 rows, DFV → 3 columns).
- **Chain-caught combos:** combos trigger ONLY on player swap; adjacent PUs caught in a blast chain individually (current behavior).
- **Move count:** combo swap = 1 move.

---

## Engine feasibility (against the current detonation-queue model)

**Cheap — parametrize existing effects, slot into the queue:**
- #2 Fly×Scarab: `detDragonfly` with a 3-line width parameter.
- #7 Fly×Fly: enqueue two Fly detonations (H + V) at the same cell. Nearly free.
- #9 Scarab×Scarab: `detScarab` with radius parameter (1→2).
- #4 Hopper×Scarab: existing Hopper choice flow; swap the target-clear step for a `detScarab` at the landing cell.
- #1 Fly×Hopper: same shape as #4 — landing step enqueues a Fly detonation instead.

**Medium — one new mechanism, reused three times:**
- #3 / #5 / #6 (Ball family): needs a **convert-gems-to-PUs step** (set `.pu` on all cells of a color, render, then enqueue all of them). The queue already handles mass sequential detonation; conversion itself is new but small.

**Harder — flag before building:**
- #10 Ball×Ball: gem clear is trivial, **but "reduce HP on all obstacles" depends on obstacle break mechanics, which do not exist yet** (obstacles are visual-only today). This combo lands after obstacle HP is built, or ships gems-only first.

*(With auto-pick decided for #5 and #8, both drop to "cheap" — chain-caught hopper auto-targeting already exists; #5 is the Ball-family conversion + N auto-hoppers through the queue, #8 is 3 auto-hoppers + a radius-1 blast at origin.)*

**No changes needed to:** swap detection (one guard clause already reserves the gesture), gravity/cascade sequencing, chain cycle-safety.

---

## Non-goals (this document)

- No code. No new effect types built. No swap-detection changes.
- PU⇄PU keeps bouncing as invalid until Jed approves this spec.
- Not committed to main — on-disk draft only.
