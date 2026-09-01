# Two engine bugs — Level 2, HousesInMotion.mov (2026-08-31)

Found by Jed watching the clip back. Frame indices are DECODED frames of
`AkashicCEO/Clips/HousesInMotion.mov` (560 frames, VFR); times are that file's
own PTS, so both are unambiguous. Neither is a capture artifact — both were
re-verified by per-cell pixel tracing, not by eyeballing the video.

Board is 11 columns x 9 rows. R1C1 is top-left.

---

## BUG 1 — a gem clears that was never part of the match

**Move 1** (the top swap): R3C4 <-> R4C4, which lines up gold diamonds at
R3C2 / R3C3 / R3C4.

| idx | t | what happens |
|-----|------|--------------|
| 105-127 | 1.75-2.25s | swap animation into R3C4 |
| 128 | 2.27s | the three gold diamonds detonate — correct |
| **141** | **2.48s** | **R4C1 (red heart) shatters too** |
| 148+ | 2.62s+ | column 1 collapses and refills |

R4C1 is not in the match and has no match of its own:

- horizontally, R4 is `heart heart diamond star ...` — hearts at C1 and C2 only, two is not three
- vertically, C1 is `... triangle(R3) heart(R4) triangle(R5) ...` — no run
- it is not adjacent to the match (the match is row 3, columns 2-4; R4C1 is diagonal to R3C2)

It also clears **13 frames late**, on its own beat, rather than with the match.
That lag is the useful clue: it looks like a second clear pass running after the
primary one, resolving against stale or wrongly-indexed board state, rather than
the match detector over-selecting at match time.

Evidence strip: `houses-in-motion-20260831-bug1.png`

---

## BUG 2 — a bottom-row power-up changes columns by itself

**Move 2** (the bottom swap) forms a Grasshopper in row 9. Tracked by its own
sprite colour (bright green, G>135 and G>R+50) across every frame:

| idx | t | position |
|-----|------|----------|
| 206 | 3.62s | forms at **R9C6** |
| 232 | 4.07s | **R9C7** |
| 307 | 5.72s | **R9C6** |
| 320 | 6.22s | **R9C7** — and stays there to the end |

So it is not one shift, it is an oscillation: C6 -> C7 -> C6 -> C7.

Row 9 is the bottom row, so gravity cannot move it, and no swap touches it after
it forms. A power-up changing column with neither a swap nor a fall is not a
legal board transition at all. Cascades are running elsewhere on the board
throughout this window, so the suspicion is that a refill/compaction pass is
rewriting the hopper's cell index while the chain resolves.

Evidence strip: `houses-in-motion-20260831-bug2.png`

---

## Status

Not fixed, and deliberately not blocking the clip — Jed's call: the clip ships
with the bugs in it, because shipping it is what surfaced them. Reproduce by
replaying Level 2 with the same two swaps.

---

## BUG 3 — clear VFX fires on cells that never matched, and never clear

Source: `AkashicCEO/Clips/HousesInMotion_bug02.mov` (155 frames, 4.0s, VFR).
Same Level 2 board geometry. Found by Jed; frames below are decoded indices of
that file.

The move: swap R7C7 (silver star) <-> R7C8 (gold diamond), which stacks silver
stars at **C8 R6/R7/R8** — a legal vertical three.

| idx | t | what happens |
|-----|------|--------------|
| 63-79 | 1.08-1.35s | swap animation |
| 80 | 1.37s | C8 R6/R7/R8 stars clear — **correct** |
| 80-92 | 1.37-1.58s | nothing else on the board moves; no gravity, no refill |
| **93** | **1.62s** | **gold particles + the dotted "clearing" cell separators appear on C4 R5/R6/R7** |
| 102 | 1.92s | particles peak |
| 120 | 2.27s | **the C4 gems are still sitting there, untouched** |
| ~122 | 2.40s | the board finally starts falling/refilling |

C4 R5/R6/R7 is `gold diamond / gold diamond / green triangle`. It has no match
on either axis:

- vertically C4 reads `hexagon(R4) diamond(R5) diamond(R6) triangle(R7)` — two diamonds, not three
- R5 reads `diamond(C3) diamond(C4) grasshopper(C5)` — two, not three
- R6 reads `hexagon(C3) diamond(C4) grasshopper(C5)` — one

**This is the visual half of a clear with no logical half.** Unlike BUG 1, no gem
is removed and the column never collapses — the detonation effect is simply
dispatched at the wrong cells. Cosmetically minor, diagnostically loud: something
is handing the VFX layer coordinates that the board logic did not act on.

Evidence strip: `houses-in-motion-20260831-bug3.png`
(yellow box = the phantom C4 cells, cyan box = the real C8 match)

---

## The thread connecting BUG 1 and BUG 3

Both phantoms fire **13 frames after a legitimate match**, on their own beat,
with the board otherwise still:

| | real match | phantom | gap |
|---|---|---|---|
| BUG 1 | idx 128 (R3C2/C3/C4 diamonds) | idx 141 (R4C1 heart) | 13 frames |
| BUG 3 | idx 80 (C8 R6/R7/R8 stars) | idx 93 (C4 R5/R6/R7) | 13 frames |

Two samples is not a proof, and both files are VFR so the wall-clock gaps differ
slightly (0.22s vs 0.25s) — but the identical *frame* count across two different
moves on two different board states is worth testing first. It points at a
delayed second pass over match results rather than at the match detector itself.

They differ in how far the phantom gets:

- **BUG 1** completed — the gem was removed and the column collapsed
- **BUG 3** stopped at the VFX — particles drew, nothing was removed

That difference is the useful one. If both come from the same delayed pass, then
something downstream of it decides whether the phantom cells also get cleared,
and in BUG 3 that check happened to reject them. Find the pass, and both go.
