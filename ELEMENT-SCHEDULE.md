# Element Schedule — when each element first appears

**Status:** authority for level placement, like `CELL-ENGINE.md`. Written 2026-11-12.

**The rule:** in every bundle family, an element first appears at the SAME family level number.
A level may only use elements whose debut level is at or below its own family level number.
At its debut level an element gets a proper introduction: simple board, the new thing front and centre.

**In our engine?** `yes` = may be used now. `no` = future — **never put a `no` element in a level.**

**Sources:** (W) the Township wiki's Match-3 element table, read 2026-11-12 —
https://township.fandom.com/wiki/Match-3 · (B) our built levels 1–50 (Akashic Flow 1–25, Akashic Window 26–50),
ground truth where they disagree with anything else · (P) proposed here, Jed's call.
The "source name" column is internal reference only; players never see it.

## Elements

| Debut level | Element (source name) | Our name | In our engine? | Notes |
|---|---|---|---|---|
| 1 | Pieces, match goals | Gem · collect goal | yes | W, B. Levels 1–5 are gems only. |
| 1 | Rocket / Dynamite / Helicopter / Rainbow Ball (made by matching) | Dragonfly / Scarab / Grasshopper / Akasha Ball | yes | Made by the player from level 1. Names LOCKED. |
| 6 | Carpet (grass) | Clover · plant goal | yes | W 6, B 6. |
| 8 | Chains | Chain | yes | W 8, B 8. 1 hit at debut. |
| 12 | Acorns in Leaves | Egg under a Leaf | yes | W 12, B 12. A bare egg is unwinnable. |
| 18 | Key | Key | yes | W 18, B 18. |
| 22 | Crate | Crate | yes | W 22, B 22. |
| 31 | Vinyl Record | Tire | yes | W 31, B 31. |
| 41 | Portals | Window | yes | W 41, B 41. Blue Exit, orange Re-entry, paired 1:1. |
| 51 | Soda Fridge | Larder — PROPOSED | no | W 51. Match beside it to collect what's inside. |
| 71 | Walls | Barrier (breakable, yellow) | yes | W 71. No published level uses one yet. |
| 91 | Suds | Stage Fog — PROPOSED | no | W 91. Spreads; the level is lost if it fills the board (needs a loss state we don't have). |
| 111 | Generator | Generator | yes | W 111. Engine has it; no published level uses one yet. |
| 131 | Ice | Frost — PROPOSED | no | W 131. |
| 161 | Motor Oil | Oil | no | W 161. The `o` substrate letter round-trips but has no behaviour. |
| 191 | Surprise Box | Encore Box — PROPOSED | no | W 191. |
| 221 | Statues | Caryatid — PROPOSED | no | W 221. |
| 251 | 3D Printers | Locksmith — PROPOSED | no | W 251. Produces keys. |
| 301 | Soap Foamer | Fog Machine — PROPOSED | no | W 301. |
| 351 | Chestnut | Cornerstone — PROPOSED | no | W 351. |
| 401 | Rolling Shutters | Stage Curtain — PROPOSED | no | W 401. |
| 476 | Rich Suds | Dry Ice — PROPOSED | no | W 476. |
| 576 | Gramophone | Calliope — PROPOSED | no | W 576. |
| 676 | Cobwebs | Tangle — PROPOSED | no | W 676. |
| 776 | Puzzles | Mosaic — PROPOSED | no | W 776. |
| 856 | Bag of Grass | Seed Sack — PROPOSED | no | W 856. Spreads clover. |
| 956 | Ice Bombs | Cold Snap — PROPOSED | no | W 956. |
| 2006 | Unbreakable Walls | Barrier (unbreakable, striped) | yes | W 2006. **In the engine, but far too late for any family built so far — don't use it.** |

Later wiki entries, all `no`, unnamed: Plastic Track 1206 · Ceramic Tiles 1281 · Mailbox 1606 · Plasma Lamp 1706 ·
Oil Canister 1806 · Light Bulbs 1906 · Parking Meters 2156 · Case 2306 · Soap Bar 2456 · Battery Pack 2606 ·
Robot Vacuums 2756 · Strobe Beacons 2906 · Light Bulbs and Boards 3056 · Box of Fireworks 3236 · Water Pump 3416 ·
Tubes of Paint 3596 · Lawnmower 3776 · Pneumatic Tube 3956 · Paint Jar 4136 · Safe 4316 · Compass 4496 · Ivy 4676 ·
Steam 4856 · Books 5036 · Ducks 5216 · Ring Box 5396 · Steam Cooker 5576 · Suitcase 5756 · Leather 5936 ·
Potted Plant 6116.

## Variations of an element (not on the wiki; from our built levels, or proposed)

| Debut level | Variation | In our engine? | Notes |
|---|---|---|---|
| 7 | Power-up already on the board at the start | yes | B 7. |
| 8 | Authored-empty cell (`e`) | yes | B 8. |
| 13 | Leaf, 2 hits | yes | B 13. |
| 20 | Multi-stage level, tall | yes | B 20. No keys on a tall multi-stage unless the stages are split by a row of holes. |
| 23 | Multi-stage level, wide | yes | B 23. |
| 25 | Flow other than straight down | yes | B 25. |
| 29 | Crate, 2 hits | yes | B 29. |
| 38 | Chain, 2 hits | yes | B 38. |
| 41 | Key respawn (goal larger than keys placed) | yes | B 41. |
| 51 | Tire, 2 hits | yes | P. No built level has one; placed one bundle after the tire's debut. |
| 76 | Any element at 3 hits | yes | P. No built level has one. |

## Open questions for Jed

1. ~~Generators debut at 111 on the wiki — the fifth bundle of a family, not the third.~~ **SETTLED (Jed 2026-11-12): keep at 111.**
2. **Unbreakable barriers debut at 2006.** Seven of the Fable levels used them; they have been changed to breakable.
3. The three **PROPOSED** variation debuts (tire 2 hits at 51, anything 3 hits at 76) are placeholders.
4. Key respawn: the footage shows it at Township 28, but our first built level with a respawn goal is 41. This table uses 41.
