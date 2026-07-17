# HANDOFF — akashictimes.com

## 2026-07-16 — Touch support: unified Pointer Events swap (`caa1f1f`)

**Task (Jed):** replace mouse-only swap detection with Pointer Events so a single
touch drag between adjacent cells produces one swap — no two-tap requirement.

**File touched:** `editor/index.html` (only — layout/viewport/palette untouched).

**What changed:**
- Cell `mousedown` → `pointerdown` (covers mouse + touch + pen). In play mode it
  selects the cell AND arms a drag tracker (`dragSwap = {r,c,x,y,pointerId,fired}`).
- New document-level `pointermove` tracker: reads the pointer's movement vector;
  once it crosses ~⅓ cell (min 10px), fires exactly ONE `playTap` toward the
  dominant direction (up/down/left/right). Vector-based because touch pointers
  implicitly capture to the origin cell — cell-to-cell `mouseenter` tracking never
  fires on touch, which is why iPhone drags were dead.
- Old `mouseenter` drag-to-swap branch removed (handler kept for hover info +
  editor paint) so mouse drags can't double-fire. `pointerup`/`pointercancel`
  clear the gesture. `document mouseup` listener replaced by these.
- `.cell{touch-action:none}` — required so touch drags reach the tracker instead
  of scrolling the page (input behavior, not layout).
- Guards: one gesture = one swap attempt (`fired` flag); a drag after a tap-tap
  swap or PU activation is inert (origin must still be the live selection).
  Tap-tap and PU double-tap behavior unchanged.

**Tested** (touch-simulated 375×812 viewport, synthetic `pointerType:'touch'`
gestures): single drag = select + one directional swap; sub-threshold jitter
inert; continued movement doesn't refire; valid swap commits (moves +1) and
cascades settle; tap-tap regression clean; no double-fire. Note for future
in-pane testing: the embedded preview tab reports `visibilityState:'hidden'`
during script calls, so native `requestAnimationFrame` stalls — shim rAF with
`setTimeout(cb,16)` in the test session (never in shipped code) to let swap
animations complete.

**Not covered here (own task):** viewport/meta scaling for phones, editor-mode
touch painting, long-press semantics.
