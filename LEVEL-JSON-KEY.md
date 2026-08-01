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
| `board` | `{rows, cols}` |
| `gemTypes` | colors in play — any of `red blue green yellow purple white` |
| `seeding` | `"random"` — color-seed policy (only value for now; Township-adversarial is a future value) |
| `layers` | the six cell grids (below) |
| `props` | HP companion maps (below) |
| `borders` | Layer 7 seam list — `[]` until border painting ships |
| `objectives` | win conditions (below) |
| `flyover` | present only on flyover levels: `{axis:"x"|"y", viewRows, viewCols, stops}` |

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
(a hole can't hold those). `contents` is the exception — an active cell always has
some content, so `.` there is strictly a hole.

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

1. **Power-up letters map to LEGACY engine ids, not the game's names.** Recommend
   re-lettering to the real PU vocabulary so the bytes read true (same cleanup class
   as dropping `moveLimit`). Current mapping — **the game-PU column needs Jed**:

   | Letter | Internal id | Game PU (to confirm) |
   |---|---|---|
   | `S` | helicopter | Grasshopper? |
   | `H` | rocket_h   | ? |
   | `V` | rocket_v   | Dragonfly? |
   | `A` | bomb       | Scarab? |
   | `W` | rainbow    | Akasha Ball? |

   Note: 5 internal ids but 4 branded PUs — one is a variant/booster or a mismap.

2. **Borders (Layer 7)** emits `[]` — no paint tool yet. Planned per-seam shape:
   `{seam, type:"breakable"|"unbreakable", hp}`.

3. **`seeding`** is always `"random"` — the adversarial color policy (Painter Layer
   Model meta) is a future value, not yet emitted.
