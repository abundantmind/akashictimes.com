# Level JSON Key — canonical serializer legend

**Schema:** `akashic-level/1` · emitted by `serializeLevel()` (editor/index.html, ⌘ Serialize).
**This is the authoritative meaning of every character in a serialized level.**
Pairs with PAINTER-LAYER-MODEL.md (the 7-layer taxonomy) — that doc says *what the
layers are*; this doc says *what the bytes mean*.

---

## Top-level fields

| Field | Meaning |
|---|---|
| `schema` | `"akashic-level/1"` |
| `engineVersion` | integer — the engine this level was authored **and verified** against. Absent (or `null`) = `1`. See below. |
| `board` | `{rows, cols}` |
| `gemTypes` | colors in play — any of `red blue green yellow purple white` |
| `seeding` | `"random"` — color-seed policy (only value for now; Township-adversarial is a future value) |
| `layers` | the six cell grids (below) |
| `props` | HP companion maps (below) |
| `borders` | Layer 7 seam list — `[]` until border painting ships |
| `objectives` | win conditions (below) |
| `flyover` | present only on flyover levels: `{axis:"x"|"y", viewRows, viewCols, stops}` |

## `engineVersion` — the pin

`serializeLevel()` stamps every save with the **running build's** `ENGINE_VERSION`
(editor/index.html), not the version the file arrived with: the engine that saved it
is the engine that verified it plays.

`loadLevelData()` **refuses** any level declaring a version this build does not play,
before it touches a single byte of board state, and tells the player to update. The
failure this prevents is the only one git cannot undo: a level authored under a later
engine being *silently misread* by an earlier one after a rollback. A marketplace
bundle that plays differently under a new engine was never immutable — and immutability
is the promise the money rides on.

**Bump `ENGINE_VERSION` only when a change alters how EXISTING data plays.** A new
mechanic that a level opts into through its own data (crates, clover, painted Inlets,
suds) is *additive* — one engine, no bump. See `project_engine_versioning`.

## The grids — `layers.*`

Each grid is `rows` strings of `cols` characters, row-major.

| # | `layers.*` | Char → meaning |
|---|---|---|
| 1 | `board`     | `#` active · `.` hole |
| 2 | `flow`      | `v` down · `^` up · `<` left · `>` right · `.` hole |
| 3 | `source`    | `I` inlet · `D` drain · `.` none/hole |
| 4 | `substrate` | `c` clover · `o` oil · `.` none/hole |
| 5 | `contents`  | `g` gem · `e` empty (starts gem-free) · `k` key · `a` acorn · `x` crate · `S H V A W` power-ups · `.` hole |
| 6 | `overlay`   | `B` chain (bind) · `L` leaf · `.` none/hole |

**`.` convention:** *hole* in `board`; *hole-or-none* in flow/source/substrate/overlay
(a hole can't hold those). In `contents`, an active cell always emits a non-`.` char —
but **`e` (empty) is one of them**: an active cell that starts gem-free and fills only
after the first swap (`field.empty`). So `.` in `contents` = strictly a hole; `e` = an
*authored empty* cell. Essential from L14 on — the editor's **∅ Empty** brush paints it.

**Gem COLOR is not stored.** `g` = "a gem lives here"; the color is seeded at load
(random policy). Only the cell TYPE round-trips — this is what makes the fingerprint
and exact-dup detection work.

## `props` — HP companion maps (written only when hp > 1)

- `props.contents` — crate HP, e.g. `{"R2C3":{hp:2}}`
- `props.overlay`  — chain/leaf HP, e.g. `{"R1C1":{hp:1}}`

## `objectives`

- `{type:"collect", gem:"<color>", count:N}`
- `{type:"collect", item:"key"|"acorn", count:N}`
- `{type:"plant", obstacle:"clover", count:N}`

`moveLimit` is **not** a field — no purpose in Akashic Swaps (Jed 2026-07-31).

---

## Open canonicalize decisions (Jed's call)

1. **Power-up letters map to LEGACY engine ids.** Mapping CONFIRMED (Jed 2026-08-01):

   | Letter | Internal id | Game PU |
   |---|---|---|
   | `S` | helicopter | Grasshopper |
   | `H` | rocket_h   | Dragonfly (horizontal) |
   | `V` | rocket_v   | Dragonfly (vertical) |
   | `A` | bomb       | Scarab |
   | `W` | rainbow    | Akasha Ball |

   4 branded PUs — **Dragonfly has two orientations (H + V)**, which is the "5 ids".
   OPEN: whether to re-letter to a brand-derived alphabet so the bytes read true
   (same cleanup class as dropping `moveLimit`). Jed's call before the loader locks.

2. **Borders (Layer 7)** emits `[]` — no paint tool yet. Planned per-seam shape:
   `{seam, type:"breakable"|"unbreakable", hp}`.

3. **`seeding`** is always `"random"` — the adversarial color policy (Painter Layer
   Model meta) is a future value, not yet emitted.
