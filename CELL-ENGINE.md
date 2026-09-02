# CELL ENGINE — the invariant-first rebuild

**Status:** FOUNDATION. Started 2026-09-01, invariant-first, at Jed's direction
after the reactive Engine 2 attempt was declared dead and reverted off the live
site. This doc is the single authority; it consolidates and replaces the three
older scattered specs (CELL-CENTERED-MODEL / -SPEC / CELL-ENTITY-ARCHITECTURE)
and the abandoned `engine2/index.html` retrofit sandbox.

## Why the last attempt died (the lesson, so we don't repeat it)

Engine 1 is turn-based: clear → gravity-to-fixpoint (one global batch) → rescan
→ repeat, behind one global `animating` lock. The reverted "Engine 2" tried to
make that *feel* continuous by running multiple whole-board fixpoint passes
concurrently and rebasing in-flight animations to hide the collisions — then
patched every place the collisions showed, one commit per symptom Jed happened
to trip over. 19 commits of that produced a build that passed 352 tests and
still ghost-matched, because **a patch pile has no invariant to be correct
toward.** The phantom clear was never a line-bug; it was what that architecture
does in every case nobody thought to test.

**This rebuild inverts the order: the rules are written first, as executable
invariants, and the engine is built to satisfy them by construction.** A bug we
can describe should become a line you *cannot write*, not a patch you add.

---

## The model — a continuous falling simulation

The board is **not** a turn-based machine. It is a cellular automaton on one
fixed-timestep tick clock (~60fps). Falling-sand, not chess.

### Two Dictionaries (the entity foundation — the whole reason the old code was scrapped)

The array model `board[r][c]` has no stable answer to *"which gem is this?"*
while a gem is mid-fall — moving a gem means copying its data to the next slot,
and identity evaporates in transit. That ambiguity is what made cascades
incomprehensible. Entities in a Map give every gem one permanent id; cells only
*point* at ids. Nothing is copied, identity survives the whole fall, and
matching / clearing / animation all reference the same stable object.

```
cells : Map<CellKey, Cell>          // the board, keyed by position
Cell = { r, c,
  active,            // true = playable, false = hole (transparent)
  flow,              // 'down'|'up'|'left'|'right'  — per-cell river direction
  substrate,         // null | 'clover' | ...       — plant-on-contact layer
  obstacle,          // null | { type:'crate'|'chain'|'leaf', hp }
  source,            // null | 'inlet' | 'drain'
  occupant,          // GemId | null  — the gem whose HOME is this cell
  reservedBy }       // GemId | null  — a gem currently SLIDING into this cell

gems : Map<GemId, Gem>              // every gem/item/power-up as an entity
Gem = { id, kind,                   // kind: a color, or 'key'|'acorn', or a PU type
  state,             // 'SEATED' | 'SLIDING'
  home,              // CellKey — the cell this gem belongs to
  from, to, p }      // SLIDING only: source cell, dest cell, progress p ∈ [0,1)
```

`CellKey` format is an open decision — see §Decisions. A gem is in exactly one
of two states: **SEATED** (at rest in its home cell) or **SLIDING** (animating
along ONE path from `from` to `to`, reserving `to` so nothing else falls in).
There are no passes and no global lock. One loop; every cell does a bounded
local update each tick.

### The tick loop (the whole engine), order fixed

```
tick(dt):
  1. ADVANCE   each SLIDING gem: p += dt/slideDur along its path, clamped to
               terminal velocity. At p≥1 it SEATS in `to` (reservation → occupancy).
  2. GRAVITY   each active empty & unreserved cell pulls ONE upstream donor (per
               its flow; diagonal upstream in the same gravity-region if straight
               upstream is a hole). Donor must be a SEATED movable gem → launch it
               SLIDING. One donor per cell, one launch per gem, per tick. If the
               straight feed is hole-blocked, a RESTING diagonal donor slips in
               instead (I11, drift), same-region only.
  3. SPAWN     each empty & unreserved INLET cell spawns a new gem SLIDING in
               from open sky (seeded PRNG, so refill is deterministic — I9).
               Behind world.spawns; settle-checking scenarios leave it off.
  4. MATCH     scan 3+ runs among SEATED & STABLE gems ONLY (see key rule).
  5. RESOLVE   for each match cluster this tick: clear it (VFX, remove gems, spawn
               PU at anchor, plant clover, splash crates/leaves, enqueue detonations).
               Cleared cells become empty & unreserved — next tick's gravity fills them.
  6. INPUT     accept a swap on any cell whose neighbourhood is SEATED & stable.
  7. RENDER    draw from cell/gem state; VFX is a function of state, never dispatched.
```

Overlap-refill, clear-on-settle, and swaps-during-cascade are **emergent** from
1–6, not special cases. That is the point.

### The key rule

> **Matches are detected and cleared every tick — but ONLY among SEATED, STABLE
> gems. A gem SLIDING or about-to-fall can never participate in a match.**

The accordion (I10) is a local per-cell rule: a cell must sit empty ~40ms
before it may pull the gem above it, so each freshly-vacated cell waits its turn
and the column stretches then compresses — never a rigid block. Clear-on-settle
falls out for free and correct by construction; nothing ever
"matches through" a cell it is only passing. Stability guard: a seated gem with
an empty/unreserved cell beneath it (per flow) is NOT stable this tick.

---

## THE INVARIANTS (the rules, before the code)

These hold at the END of every `tick()`, over `(cells, gems)`. Each is a runnable
check in `editor/tests/cell-engine-invariants.js`. Each maps to a real failure
from the catalog that it makes structurally impossible. The engine is built to
satisfy these; a change that violates one is wrong by definition, not by taste.

| # | Invariant | The bug it makes unwritable |
|---|-----------|-----------------------------|
| I1 | **One occupant.** Each cell has ≤1 gem as `occupant`; each gem is the occupant of ≤1 cell. | two gems in a cell (overlap) |
| I2 | **Reservation exclusivity.** A cell reserved or occupied cannot be the `to` of any other SLIDING gem; a SLIDING gem reserves exactly its `to`. | two gems converging on one cell (crossing paths) |
| I3 | **Conservation.** Every active non-empty cell points to exactly one live gem id; every live gem is either some cell's occupant OR sliding into exactly one reserved cell. No gem lost, duplicated, or in an inactive cell. | gems in holes; duplicated / vanished gems |
| I4 | **Cleared == Matched.** The set of cells cleared in RESOLVE this tick equals exactly the set the MATCH step marked. Nothing clears unmatched; nothing matched is left uncleared. | **phantom clear (bugs 1 & 3)** |
| I5 | **Motion only by slide.** A gem's `home` changes only via a SLIDING transition that reached p≥1. No occupant jumps cells without a completed slide. | **wandering power-up (bug 2)** |
| I6 | **Match reads rest only.** No gem in a MATCH cluster was SLIDING or unstable at MATCH time. | matching through moving water |
| I7 | **Quiescence is derived.** "Quiet" ⇔ (no SLIDING gem) ∧ (no gem that CAN fall) ∧ (no match among SEATED stable gems). Never remembered per-chain, always computed. | the Still Water freeze class |
| I8 | **Input legality.** A swap is accepted ⇔ both cells SEATED & stable & adjacent. Derived from state, not a global flag. | swap accepted into moving water / refused wrongly |
| I9 | **Determinism.** Same `(cells, gems, input, dt-sequence, seed)` ⇒ identical result. Spawns use a seeded PRNG. | non-reproducible cascades; untrustworthy tests |
| I10 | **The accordion.** A column falls as a Slinky: the gem above a gap starts first, each gem above it delayed ~40ms (Township's measured stagger). A column may never fall as a rigid block at one speed. | the dead, "everything drops at once and at the same speed" look Jed calls the biggest tell of a cheap match-3 |
| I11 | **Diagonal slip (drift).** A cell whose straight feed is blocked forever by a hole is fed from a RESTING diagonal-upstream donor in its OWN gravity region — gems flow around notches instead of leaving dead gaps, and isolated pockets never leak. | dead gaps under every hole; a gem vanishing or a corner island bleeding into the board |

The old suite discovered rules by tripping over their absence. This list is the
inverse: the rules are declared, and the tests fail until the engine obeys them.

---

## Open decisions (▢ = Jed's call)

- **▢ CellKey format.** `"r,c"` string (simplest, debuggable) · packed int
  `r*COLS+c` (fastest) · `{r,c}` object (needs a stable hash). Recommendation:
  string now, swap to packed int only if profiling demands it.
- **▢ Where it lives / how it grafts.** Three shapes, and this one gates
  everything downstream:
  1. **New module** `editor/cell-engine.js`, developed against the invariant
     harness, then grafted into `editor/index.html`'s play path behind the
     bundle's declared engine field (the two-engines-one-bundle plan).
  2. **Grow in place** inside `editor/index.html`, replacing the resolve/gravity
     core incrementally. Highest regression risk to the live 25.
  3. **Fork the file** to `editor/play-cell.html` for the Play path only.
  The invariant harness is the same in all three, so writing it does not commit
  the choice — but the first engine code does.

---

## What we keep from Engine 1 (the logic that was correct)

The gravity-region flood-fill (`gravityWithMap`), the feed-aware inlet promotion,
the 10-combo detonation matrix, the `inPlayWindow` flyover gate, clover/chain/
crate/leaf/key mechanics — these were all *correct*. Engine 1's only sin was the
BATCH invocation and the global lock. The mechanics port onto the tick loop
nearly as-is; it is the control structure around them that changes.
