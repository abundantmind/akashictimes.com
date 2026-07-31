# Painter Layer Model — LOCKED 2026-07-28

The canonical layer taxonomy for the AkashicSwaps level painter.
**This taxonomy IS the JSON schema IS the serializer target.** Get it right once;
every mechanic after must have exactly one home in it.

---

## The decision rule (use this to place any future feature)

> **Two features belong on the SAME layer if and only if they are mutually
> exclusive on a single cell. If both can be true at once, they are different
> layers.**

Co-existence → separate layers. Replacement → same layer. A layer holds exactly
as many features as are mutually exclusive with each other — no more.
Anything that only *modifies* a feature (a number, a link) is a **property**, not
a layer.

---

## TWO coordinate spaces

- **Cell layers** — indexed by cell `(r,c)`. (Layers 1–6.)
- **Edge layer** — indexed by the *seams between* cells: vertical seams (between
  col c and c+1) and horizontal seams (between row r and r+1). An R×C board has
  R×(C−1) vertical + (R−1)×C horizontal seams. Its own paint mode — you click the
  line between two cells, not a cell. (Layer 7, Borders.)

---

## The layers

### Cell layers (indexed `(r,c)`)

| # | Layer | One value per cell | Properties |
|---|---|---|---|
| 1 | **Board** | Active · Hole | — |
| 2 | **Flow** | ↓ ↑ ← → (default ↓) | — |
| 3 | **Source/Portal** | Inlet · Drain · Portal-A↔B | portal link id |
| 4 | **Substrate** | Clover · Oil · none | — |
| 5 | **Contents** | Gem · Empty · Power-up · Item · Block(crate/weight/LP-record) · Generator | HP (crate/record); generator emission-table |
| 6 | **Overlay** | Chain · Leaf · Ice · Soap · none | HP |

### Edge layer (indexed by seams)

| 7 | **Borders** | per seam: none · Breakable · Unbreakable | HP (breakable = 1) |

Border removal is ENGINE behavior, not data: a breakable border clears when a PU
detonation's effect area *crosses* that seam (perpendicular). A parallel beam
(e.g. a V-Dragonfly against a vertical border) runs alongside and never crosses —
useless against it. The DATA stays simple: `{seam, type, hp}`.

---

## Meta — NOT paint layers (level-level fields)

- **Flyover Map** — camera regions / stops / axis that *sequences* the multi-layer
  board for scene-intro + multi-zone play. Sits on top; paints no cells.
- **Color-seeding policy** — colors are SEEDED at load, never painted. The painter
  paints "a gem lives here"; the engine assigns color. This field chooses the
  policy: random vs deterministic-adversarial (Township never replays a level with
  the same colors, and likely stacks them against the player to drive IAP — this
  is where that lives). One switch per level; zero data-model impact.

---

## Serialization shape (what the serializer emits)

- Layers **1, 2, 4** → pure single-char ASCII grids.
- Layers **3, 5, 6, 7** → a **type grid + a companion props map** (portal links,
  HP, generator config). The `patterns` ASCII section already added 2026-07-25
  (clover/crate/active) is the seed of this — extend it to every layer.
- Flyover map + seeding policy → top-level level fields.

---

## Locked calls (2026-07-28, Jed)

1. **Sources are PAINTED** (layer 3) — authoritative. The topology-inference code
   ("open sky"/"starved pocket") that caused this session's spawn bugs gets retired.
2. **Drains are real and needed** — layer 3 ships with Inlet · Drain · Portal
   (L25: gems exit top-right, keys exit bottom).
3. **Generator = Contents (layer 5) fixture** — occupies its cell (mut. excl. with
   a gem), so NOT a source; emission table is a property. Future Township feature.
4. **HP is a property, not a layer** — rides on the cell's feature in whichever
   layer owns it.
5. **Color is seeded, not painted** — layer 5's gem brush is just "fill."

---

## SCOPE STRATEGY (Jed, 2026-07-28) — NO full Township census

The Township Fandom element list is enormous (lawnmowers, etc. from L3700+). Jed
DROPPED the full-census idea. The taxonomy above already absorbs any element as
data, so we scope element-BUILDING tightly instead:

1. **Now: only the MVP-25 element set.** Wire exactly what levels 1–25 use.
2. **Next: elements in L26–50** — begun once MVP-25 passes the *PainterLayerModel
   suite of test conditions* (see below). Estimated to be **~90% of the engine**.
3. **Beyond that: the community decides.** Once the Akashic Architect community is
   running, they collectively choose which further elements to implement. Many
   Township elements may be REJECTED as not fitting the Akashic Swaps universe.

**Guiding ethos:** *"Akashic Architects determine the future, not Playrix Past."*
Township is a reference mine, not a spec. An element earns a place by fitting the
universe + serving a Bundle — never by existing in Township.

**Ship approach = PAINT-STUB:** each layer (1–7) exists and serializes complete,
but a feature is ENABLED only when a Bundle uses it.

## The PainterLayerModel test suite (framing, Jed 2026-07-28)

The layer model doubles as a TEST SPEC: MVP-25 must "pass the PainterLayerModel
suite of test conditions" before L26–50 work begins. Concretely = extend the
existing regression harness (`editor/tests/invariants.js`, `runInvariants()`) with
per-layer invariants (each layer round-trips through the serializer; the 25 painted
levels diff-match the shipped JSONs; layer co-existence rules hold). The round-trip
diff IS the MVP-25 verification Jed has been missing.

## Build order (agreed)

First code slice: fix Base-layer paint (clean pointer-capture stroke, explicit
Active/Hole brush, clean holes) + a real Save/Export (the serializer) + per-layer
instructions. **Base done right = the template for all seven layers.** Then the
remaining MVP-25 layers, then the round-trip diff harness.
