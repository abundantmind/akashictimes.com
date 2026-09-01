/* ══════════════════════════════════════════════════════════════════════════
   CELL ENGINE — INVARIANTS (the rules, written before the engine)

   This is the spec with teeth. Every check here is a property that must hold at
   the END of every tick() of the cell engine, over its two Dictionaries:

       cells : Map<CellKey, Cell>      gems : Map<GemId, Gem>

   See CELL-ENGINE.md for the model. These are declared FIRST, on purpose: the
   reverted Engine 2 discovered its rules by tripping over their absence (a patch
   per symptom, 19 commits, still ghost-matching). Here the rules come first and
   the engine is built until they pass. A change that violates one is wrong by
   definition — you do not "fix" a violation with a special case, you redesign
   the transition that produced it.

   USAGE, two ways:
     1. As guardrails inside the engine (dev builds): call assertInvariants(w)
        at the end of tick() to catch a violation the instant a transition
        introduces it — with the invariant number, not 13 frames downstream.
     2. As a scenario suite: build a world, drive N ticks, assert after each.
        runCellInvariants() at the bottom is the harness entry point; it is
        SKELETAL until an engine exists (it reports "pending: no engine") and
        turns green scenario by scenario as the engine is built to satisfy each.

   Nothing here imports the engine. Invariants are pure functions of state, so
   they can judge any world the engine produces without knowing how it produced
   it — which is exactly why they can be written before it.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ── helpers over the entity model ────────────────────────────────────────
  // A "world" is { cells:Map, gems:Map, cols, rows }. Cells point at gem ids;
  // gems carry their own state. These readers are the only assumptions the
  // invariants make about shape — keep them in sync with CELL-ENGINE.md.
  const isSliding = g => g && g.state === 'SLIDING';
  const isSeated = g => g && g.state === 'SEATED';
  const liveGems = w => [...w.gems.values()];
  const activeCells = w => [...w.cells.values()].filter(c => c.active);

  // Each check returns null when it holds, or a short violation string naming
  // the offending ids/keys so a failure points at the cell, not the symptom.

  // I1 — One occupant. ≤1 gem per cell, ≤1 home cell per gem.
  function I1_oneOccupant(w) {
    const seen = new Map();                       // gemId -> the cell claiming it
    for (const c of w.cells.values()) {
      if (c.occupant == null) continue;
      if (!w.gems.has(c.occupant)) return `I1: cell ${c.r},${c.c} occupies missing gem ${c.occupant}`;
      if (seen.has(c.occupant)) return `I1: gem ${c.occupant} is occupant of two cells`;
      seen.set(c.occupant, c);
    }
    return null;
  }

  // I2 — Reservation exclusivity. A reserved/occupied cell is the `to` of no
  // other slider; a SLIDING gem reserves exactly its `to`.
  function I2_reservation(w) {
    const targeted = new Map();                   // cellKey -> gemId sliding into it
    for (const g of w.gems.values()) {
      if (!isSliding(g)) continue;
      if (g.to == null) return `I2: sliding gem ${g.id} has no destination`;
      if (targeted.has(g.to)) return `I2: cell ${g.to} is target of gems ${targeted.get(g.to)} and ${g.id}`;
      targeted.set(g.to, g.id);
      const dest = w.cells.get(g.to);
      if (!dest) return `I2: gem ${g.id} slides into missing cell ${g.to}`;
      if (dest.reservedBy !== g.id) return `I2: cell ${g.to} not reserved by its slider ${g.id}`;
      if (dest.occupant != null) return `I2: gem ${g.id} slides into occupied cell ${g.to}`;
    }
    // and no reservation without a matching slider
    for (const c of w.cells.values()) {
      if (c.reservedBy != null && !targeted.has(cellKey(c)))
        return `I2: cell ${c.r},${c.c} reserved by ${c.reservedBy} with no slider`;
    }
    return null;
  }

  // I3 — Conservation. No gem lost, duplicated, or stranded in a hole.
  function I3_conservation(w) {
    for (const c of w.cells.values()) {
      if (!c.active && c.occupant != null)
        return `I3: inactive cell ${c.r},${c.c} holds gem ${c.occupant}`;
    }
    for (const g of w.gems.values()) {
      const homed = [...w.cells.values()].some(c => c.occupant === g.id);
      const sliding = isSliding(g) && w.cells.get(g.to) && w.cells.get(g.to).reservedBy === g.id;
      if (isSeated(g) && !homed) return `I3: seated gem ${g.id} is nobody's occupant`;
      if (isSliding(g) && !sliding) return `I3: sliding gem ${g.id} reserves nothing`;
    }
    return null;
  }

  // I4 — Cleared == Matched. THE phantom-clear guard. The engine must expose,
  // for the tick just resolved, the set of cells MATCH marked and the set
  // RESOLVE cleared. They must be equal. (Checked from a per-tick trace the
  // engine records; absent a trace this is pending, not passing.)
  function I4_clearedEqualsMatched(trace) {
    if (!trace || !trace.matched || !trace.cleared) return null;   // nothing resolved this tick
    const m = new Set(trace.matched), c = new Set(trace.cleared);
    for (const k of c) if (!m.has(k)) return `I4: cleared unmatched cell ${k} (PHANTOM CLEAR)`;
    for (const k of m) if (!c.has(k)) return `I4: matched cell ${k} left uncleared`;
    return null;
  }

  // I5 — Motion only by slide. A gem's home changed this tick ⇒ it just completed
  // a slide. Compared against the previous tick's snapshot the engine passes in.
  function I5_motionOnlyBySlide(w, prevHome, seatedThisTick) {
    if (!prevHome) return null;
    for (const g of w.gems.values()) {
      const was = prevHome.get(g.id);
      if (was != null && g.home !== was && !(seatedThisTick && seatedThisTick.has(g.id)))
        return `I5: gem ${g.id} moved ${was}→${g.home} without a completed slide (TELEPORT)`;
    }
    return null;
  }

  // I6 — Match reads rest only. No matched gem was sliding/unstable at match time.
  function I6_matchReadsRest(trace, w) {
    if (!trace || !trace.matchedGemIds) return null;
    for (const id of trace.matchedGemIds) {
      const g = w.gems.get(id);
      if (g && isSliding(g)) return `I6: sliding gem ${id} was in a match`;
    }
    return null;
  }

  // I7 — Quiescence is derived, never remembered. quiet ⇔ no slider ∧ no seated
  // match. The engine's reported `quiet` must equal the computed truth.
  function I7_quiescenceDerived(w, reportedQuiet, hasSeatedMatch) {
    const anySliding = liveGems(w).some(isSliding);
    const truth = !anySliding && !hasSeatedMatch;
    if (reportedQuiet != null && reportedQuiet !== truth)
      return `I7: engine says quiet=${reportedQuiet} but truth=${truth}`;
    return null;
  }

  // I8 — Input legality. A swap is accepted ⇔ both cells seated, stable, adjacent.
  function I8_inputLegality(w, swap) {
    if (!swap) return null;
    const a = w.cells.get(swap.a), b = w.cells.get(swap.b);
    const seatedStable = c => c && c.occupant != null && isSeated(w.gems.get(c.occupant)) && c.reservedBy == null;
    const adjacent = a && b && (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1);
    const legal = seatedStable(a) && seatedStable(b) && adjacent;
    if (swap.accepted !== legal)
      return `I8: swap ${swap.a}↔${swap.b} accepted=${swap.accepted} but legal=${legal}`;
    return null;
  }

  // I9 — Determinism. Two runs of the same scenario+seed produce identical state.
  // Realized in the harness by running each scenario twice and comparing digests;
  // the check itself is the equality of two world digests.
  function I9_determinism(digestA, digestB) {
    if (digestA == null || digestB == null) return null;
    return digestA === digestB ? null : `I9: identical inputs produced different worlds`;
  }

  function cellKey(c) { return typeof root.CellKey === 'function' ? root.CellKey(c.r, c.c) : `${c.r},${c.c}`; }

  // A cheap, order-independent digest of a world, for I9.
  function digest(w) {
    const rows = [];
    for (const c of [...w.cells.values()].sort((x, y) => (x.r - y.r) || (x.c - y.c))) {
      const g = c.occupant != null ? w.gems.get(c.occupant) : null;
      rows.push(`${c.r},${c.c}:${g ? g.kind : '-'}:${c.reservedBy ?? '-'}`);
    }
    return rows.join('|');
  }

  // assertInvariants — the drop-in guard for the end of tick(). Runs every
  // state-only check and throws on the first violation, so a bad transition is
  // caught where it happens, not frames later.
  function assertInvariants(w, ctx) {
    ctx = ctx || {};
    const checks = [
      I1_oneOccupant(w),
      I2_reservation(w),
      I3_conservation(w),
      I4_clearedEqualsMatched(ctx.trace),
      I5_motionOnlyBySlide(w, ctx.prevHome, ctx.seatedThisTick),
      I6_matchReadsRest(ctx.trace, w),
      I7_quiescenceDerived(w, ctx.reportedQuiet, ctx.hasSeatedMatch),
      I8_inputLegality(w, ctx.swap),
    ];
    const bad = checks.find(Boolean);
    if (bad) throw new Error('INVARIANT VIOLATION — ' + bad);
    return true;
  }

  // runCellInvariants — scenario harness entry point. SKELETAL until an engine
  // exists: it reports each planned scenario as pending. As the engine is built,
  // each scenario constructs a world, drives ticks, and asserts — turning green
  // one at a time. The scenario list is the build order.
  function runCellInvariants() {
    const Engine = root.CellEngine || null;
    const scenarios = [
      'single gem falls into one empty cell, seats once',      // I1,I2,I3,I5
      'two columns fall, no gem enters a reserved cell',       // I2
      'bottom three seat and clear while top still falls',     // I4,I6 (key rule)
      'a swap is refused into a still-sliding region',         // I8
      'a swap is accepted in a settled region mid-cascade',    // I8 (facet B)
      'a match clears exactly its cells, nothing adjacent',    // I4 (phantom-clear guard)
      'a power-up never changes cell without a slide',         // I5 (wandering-hopper guard)
      'board goes quiet iff no slider and no seated match',    // I7
      'same seed + inputs ⇒ identical board twice',            // I9
    ];
    if (!Engine) {
      return { pending: true, engine: false, scenarios,
               note: 'no CellEngine yet — invariants declared, awaiting the engine to satisfy them' };
    }

    // Each scenario builds a world, drives ticks, and asserts the invariants
    // after EVERY tick (via drive() below), then checks its own end state. A
    // scenario turns green only when the engine satisfies every invariant on
    // every tick of it — not just at the end.
    var results = [], passed = 0;
    var DT = 1 / 60;

    // drive: run the engine to quiescence, asserting invariants each tick.
    // Snapshots home before each tick so I5 (motion-only-by-slide) can compare.
    // Swaps (when a scenario has them) are applied via Engine.applySwap BEFORE
    // the prevHome snapshot, so a swap's home change is an INPUT event, not tick
    // motion — I5 (no teleport) accounts only for what the simulation moved.
    function drive(w, maxTicks) {
      var t = 0, everCleared = false;
      while (t < (maxTicks || 600)) {
        var prevHome = new Map();
        for (var g of w.gems.values()) prevHome.set(g.id, g.home);
        var trace = Engine.tick(w, DT);
        if (trace.cleared) everCleared = true;
        var hasMatch = Engine.hasMatch(w);            // derived truth for I7
        assertInvariants(w, { prevHome: prevHome, seatedThisTick: trace.seatedThisTick,
                              trace: trace, hasSeatedMatch: hasMatch,
                              reportedQuiet: Engine.isQuiet(w, hasMatch) });
        t++;
        if (Engine.isQuiet(w, hasMatch)) break;
      }
      drive.everCleared = everCleared;
      return t;
    }

    function run(name, fn) {
      try { fn(); results.push({ name: name, pass: true }); passed++; }
      catch (e) { results.push({ name: name, pass: false, detail: e.message }); }
    }

    // Scenario 1 — a single gem falls into the one empty cell below it and seats
    // exactly once. Exercises I1/I2/I3/I5/I7 across every tick of the fall.
    run(scenarios[0], function () {
      var w = Engine.makeWorld(['R', '.']);     // gem 'R' at (0,0), empty at (1,0)
      var ticks = drive(w, 300);
      var bottom = w.cells.get(Engine.CellKey(1, 0));
      var top = w.cells.get(Engine.CellKey(0, 0));
      if (bottom.occupant == null) throw new Error('gem never reached the bottom cell');
      if (w.gems.get(bottom.occupant).kind !== 'R') throw new Error('wrong gem at bottom');
      if (top.occupant != null) throw new Error('top cell still occupied — gem did not move');
      if (w.gems.size !== 1) throw new Error('gem count changed: ' + w.gems.size);
      if (!Engine.isQuiet(w, false)) throw new Error('board not quiet after fall');
      if (ticks < 1) throw new Error('no ticks ran');
    });

    // Scenario 2 — two columns of two gems fall into the empties below. No gem
    // ever enters a reserved/occupied cell; order within each column is kept.
    // Exercises I2/I3 across many parallel sliders.
    run(scenarios[1], function () {
      var w = Engine.makeWorld(['RG', 'RG', '..', '..']);
      drive(w, 300);
      var at = function (r, c) { var o = w.cells.get(Engine.CellKey(r, c)).occupant; return o ? w.gems.get(o).kind : '.'; };
      if (at(2, 0) !== 'R' || at(3, 0) !== 'R') throw new Error('col 0 did not stack R,R at bottom');
      if (at(2, 1) !== 'G' || at(3, 1) !== 'G') throw new Error('col 1 did not stack G,G at bottom');
      if (at(0, 0) !== '.' || at(1, 0) !== '.') throw new Error('col 0 top not vacated');
      if (w.gems.size !== 4) throw new Error('gem count changed: ' + w.gems.size);
    });

    // Scenario 3 — clear-on-settle. A red falls into the bottom row, completing
    // R,R,R which clears the instant it seats — while a blue is still falling
    // down the same column above it. The clear must take EXACTLY the three reds
    // (I4) and never the blue (I6, wrong colour and/or still sliding).
    run(scenarios[2], function () {
      // (0,0)=B will trail down col 0; (2,0)=R falls to (3,0) completing row 3.
      var w = Engine.makeWorld(['B..', '...', 'R..', '.RR']);
      var ticks = drive(w, 400);
      if (!drive.everCleared) throw new Error('no clear ever happened');
      if (w.gems.size !== 1) throw new Error('expected only the blue to remain, got ' + w.gems.size);
      var last = [...w.gems.values()][0];
      if (last.kind !== 'B') throw new Error('the surviving gem is not the blue: ' + last.kind);
      if (last.home !== Engine.CellKey(3, 0)) throw new Error('blue did not settle at bottom of col 0: ' + last.home);
      if (!Engine.isQuiet(w, Engine.hasMatch(w))) throw new Error('board not quiet at end');
    });

    return { pending: passed < scenarios.length, engine: true,
             total: scenarios.length, passed: passed, results: results,
             note: passed + '/' + scenarios.length + ' scenarios green' };
  }

  const api = { assertInvariants, runCellInvariants, digest,
    checks: { I1_oneOccupant, I2_reservation, I3_conservation, I4_clearedEqualsMatched,
      I5_motionOnlyBySlide, I6_matchReadsRest, I7_quiescenceDerived, I8_inputLegality, I9_determinism } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CellInvariants = api; root.runCellInvariants = runCellInvariants; }
})(typeof window !== 'undefined' ? window : globalThis);
