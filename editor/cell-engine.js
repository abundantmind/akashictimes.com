/* ══════════════════════════════════════════════════════════════════════════
   CELL ENGINE — the continuous tick-loop Play engine (Engine "cell").

   Built invariant-first: see CELL-ENGINE.md for the model and
   editor/tests/cell-engine-invariants.js for the rules this must satisfy. The
   engine is grown one scenario at a time, smallest code that passes the next
   declared invariant scenario — never a patch added to chase a symptom.

   State is two Dictionaries (the reason the array model was scrapped: a gem in
   an array loses its identity the moment it's copied to the next slot). Here a
   gem is an entity with a permanent id; cells only point at ids.

   This file is standalone (no DOM, no dependency on editor/index.html) so it can
   be driven headless by the invariant harness. It is grafted into the live Play
   path later, behind a bundle's declared `engine` field — the live 25 stay on
   Engine 1 untouched.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ── CellKey: "r,c" string. Simplest and debuggable; swap to a packed int only
  // if profiling ever demands it (the harness reads keys through this same fn).
  function CellKey(r, c) { return r + ',' + c; }

  // ── Gem fall velocity, measured from Township's L25 board-wipe capture
  // (AkashicSwaps/GEM-FALL-VELOCITY.md). A gem does NOT enter at terminal — it
  // ramps, which is what lets the eye track it. Units: cells and seconds.
  var ENTRY = 2.3;        // cells/sec a gem begins a fall at
  var ACCEL = 48.0;       // cells/sec² while falling
  var TERMINAL = 21.0;    // cells/sec hard clamp — never exceeded in the capture

  // ── world construction ────────────────────────────────────────────────────
  // A world is built from a compact ascii spec (array of equal-length strings):
  //   '.' active empty · '#' hole (inactive) · any letter = a SEATED gem of that
  //   kind. Every cell defaults to flow 'down'. Gem ids are assigned in scan
  //   order as 'g1','g2',... — stable for the life of the gem.
  function makeWorld(spec, opts) {
    opts = opts || {};
    var cells = new Map(), gems = new Map();
    var rows = spec.length, cols = spec[0].length, gid = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var ch = spec[r][c];
        var cell = { r: r, c: c, active: ch !== '#', flow: 'down',
                     substrate: null, obstacle: null, source: null,
                     occupant: null, reservedBy: null };
        cells.set(CellKey(r, c), cell);
        if (ch !== '.' && ch !== '#') {
          var id = 'g' + (++gid);
          gems.set(id, { id: id, kind: ch, state: 'SEATED',
                         home: CellKey(r, c), from: null, to: null, p: 0, vel: 0 });
          cell.occupant = id;
        }
      }
    }
    return { cells: cells, gems: gems, rows: rows, cols: cols };
  }

  // ── flow geometry: the cell one step UPSTREAM of (r,c) per its flow. Gravity
  // pulls a donor from upstream into an empty cell. (Only 'down' is wired now;
  // the other three land when a scenario needs river flow.)
  function upstreamOf(cell) {
    switch (cell.flow) {
      case 'down':  return [cell.r - 1, cell.c];
      case 'up':    return [cell.r + 1, cell.c];
      case 'left':  return [cell.r, cell.c + 1];
      case 'right': return [cell.r, cell.c - 1];
    }
    return null;
  }

  // A gem is movable if it's SEATED and not pinned (obstacles pin later).
  function movable(g) { return g && g.state === 'SEATED'; }

  // ── the tick loop. Order is fixed (CELL-ENGINE.md §tick). Returns a trace of
  // what happened this tick, which the invariants read (matched/cleared sets,
  // the ids that seated). MATCH/RESOLVE/SPAWN are stubs until a scenario needs
  // them — added as declared invariant scenarios demand, never speculatively.
  function tick(w, dt) {
    var trace = { seatedThisTick: new Set(), matched: null, cleared: null,
                  matchedGemIds: null };

    // 1. ADVANCE — every SLIDING gem integrates its fall; seats at p≥1.
    for (var g of w.gems.values()) {
      if (g.state !== 'SLIDING') continue;
      g.vel = Math.min(TERMINAL, g.vel + ACCEL * dt);   // ramp, clamped to terminal
      g.p += g.vel * dt;                                 // p measured in cells (slide is 1 cell)
      if (g.p >= 1) {
        var dest = w.cells.get(g.to);
        dest.occupant = g.id;                            // reservation becomes occupancy
        dest.reservedBy = null;
        g.state = 'SEATED';
        g.home = g.to;                                   // home changes ONLY here (invariant I5)
        g.from = g.to = null;
        g.p = 0;
        trace.seatedThisTick.add(g.id);
        // velocity is retained on the gem, so the NEXT launch (if it keeps
        // falling) continues accelerating instead of re-entering at ENTRY —
        // that continuity is why a long fall reaches terminal.
      }
    }

    // 2. GRAVITY — each active, empty, unreserved cell pulls ONE upstream donor.
    // Processed flow-downstream-first (bottom rows first for 'down') so a lower
    // hole fills before the cell above it becomes a donor: one launch per gem.
    var order = [...w.cells.values()].sort(function (a, b) { return b.r - a.r; });
    for (var cell of order) {
      if (!cell.active || cell.occupant != null || cell.reservedBy != null) continue;
      var up = upstreamOf(cell);
      if (!up) continue;
      var donorCell = w.cells.get(CellKey(up[0], up[1]));
      if (!donorCell || !donorCell.active) continue;
      var donor = donorCell.occupant != null ? w.gems.get(donorCell.occupant) : null;
      if (!movable(donor)) continue;
      // launch: donor leaves its cell, reserves this one, begins sliding.
      donorCell.occupant = null;
      cell.reservedBy = donor.id;
      donor.state = 'SLIDING';
      donor.from = CellKey(donorCell.r, donorCell.c);
      donor.to = CellKey(cell.r, cell.c);
      donor.p = 0;
      if (donor.vel === 0) donor.vel = ENTRY;            // start of a fall from rest
    }

    // 3. SPAWN / 4. MATCH / 5. RESOLVE / 6. INPUT — stubs; filled per scenario.

    return trace;
  }

  // ── quiescence is DERIVED (invariant I7), never remembered.
  function anySliding(w) { for (var g of w.gems.values()) if (g.state === 'SLIDING') return true; return false; }
  function isQuiet(w, hasSeatedMatch) { return !anySliding(w) && !hasSeatedMatch; }

  var api = { CellKey: CellKey, makeWorld: makeWorld, tick: tick,
              isQuiet: isQuiet, anySliding: anySliding,
              constants: { ENTRY: ENTRY, ACCEL: ACCEL, TERMINAL: TERMINAL } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CellEngine = api; root.CellKey = CellKey; }
})(typeof window !== 'undefined' ? window : globalThis);
