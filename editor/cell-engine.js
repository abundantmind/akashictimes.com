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

  // ── THE ACCORDION (Slinky) — Jed's most significant Engine-1 breakthrough,
  // and the thing the first cell-engine cut lost. A column must NOT fall as a
  // rigid block: the gem directly above a gap starts first, and each gem above
  // THAT delays the start of its own fall. Township's measured stagger is 40ms
  // (Engine 1's STAGGER_MS, from the L28 slowmo). Modelled locally: a cell must
  // have been empty at least STAGGER before it may pull the gem above it, so
  // each freshly-vacated cell waits its turn — the column stretches then
  // compresses. A gem falling through already-open space is NOT delayed (that
  // space was empty long ago), so it still falls continuously; only the START
  // of each gem's fall is staggered, which is exactly the accordion.
  var STAGGER = 0.040;    // seconds a cell must sit empty before it pulls a donor

  // Default refill palette. A real level overrides this with its own gem set;
  // for now spawns draw from four colours. Spawns use the world's seeded PRNG so
  // a given (board, seed) refills identically every run — invariant I9.
  var SPAWN_KINDS = ['R', 'G', 'B', 'Y'];
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

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
                     occupant: null, reservedBy: null, emptyFor: 0 };
        cells.set(CellKey(r, c), cell);
        if (ch !== '.' && ch !== '#') {
          var id = 'g' + (++gid);
          gems.set(id, { id: id, kind: ch, state: 'SEATED',
                         home: CellKey(r, c), from: null, to: null, p: 0, vel: 0 });
          cell.occupant = id;
        }
      }
    }
    // GRAVITY REGIONS (Engine 1's drift fix): orthogonal flood-fill of active
    // cells. Diagonal slip may only pull a donor from the RECEIVER's OWN region,
    // so an orthogonally isolated pocket (a corner island) can never leak gems
    // into the main board — exactly like Township. Active set is fixed, so this
    // is computed once here, not per tick.
    var region = new Map(), rid = 0;
    for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) {
      var k0 = CellKey(rr, cc);
      if (!cells.get(k0).active || region.has(k0)) continue;
      var stack = [[rr, cc]]; region.set(k0, rid);
      while (stack.length) {
        var q = stack.pop();
        var nb = [[q[0]-1,q[1]],[q[0]+1,q[1]],[q[0],q[1]-1],[q[0],q[1]+1]];
        for (var ni = 0; ni < nb.length; ni++) {
          var nk = CellKey(nb[ni][0], nb[ni][1]), nc2 = cells.get(nk);
          if (nc2 && nc2.active && !region.has(nk)) { region.set(nk, rid); stack.push(nb[ni]); }
        }
      }
      rid++;
    }
    cells.forEach(function (cell, k) { cell.region = region.has(k) ? region.get(k) : -1; });

    return { cells: cells, gems: gems, rows: rows, cols: cols,
             // spawns OFF by default: tests that assert the board SETTLES need no
             // refill. The real game (and the demo) turn it on for endless play.
             spawns: !!opts.spawns,
             rng: mulberry32(opts.seed == null ? 0x9E3779B9 : opts.seed >>> 0),
             gidSeq: gid };
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

  // The cell one step DOWNSTREAM (where this cell's gem would fall). Used by the
  // stability guard: a gem with an empty downstream cell is about to fall and so
  // must NOT match this tick (key rule — no matching through a passing position).
  function downstreamOf(cell) {
    switch (cell.flow) {
      case 'down':  return [cell.r + 1, cell.c];
      case 'up':    return [cell.r - 1, cell.c];
      case 'left':  return [cell.r, cell.c - 1];
      case 'right': return [cell.r, cell.c + 1];
    }
    return null;
  }

  // The kind of a cell's gem IFF it is SEATED and STABLE (can't fall this tick);
  // else null. This single predicate is the key rule made executable: MATCH sees
  // a gem only when it is truly at rest.
  function stableKind(w, cell) {
    if (!cell.active || cell.occupant == null) return null;
    var g = w.gems.get(cell.occupant);
    if (!g || g.state !== 'SEATED') return null;
    var d = downstreamOf(cell);
    if (d) {
      var dc = w.cells.get(CellKey(d[0], d[1]));
      if (dc && dc.active && dc.occupant == null && dc.reservedBy == null) return null; // about to fall
    }
    return g.kind;
  }

  // Find every 3+ run (horizontal and vertical) of one kind among stable seated
  // gems. Returns the union of matched cell keys and the gem ids in them. (L/T
  // clustering and power-up spawn are a later scenario; a 3-run just clears.)
  function findMatches(w) {
    var cellsHit = new Set(), gemIds = new Set();
    function absorb(run) {
      if (run.length >= 3) run.forEach(function (key) {
        cellsHit.add(key);
        var oc = w.cells.get(key).occupant;
        if (oc != null) gemIds.add(oc);
      });
    }
    // horizontal
    for (var r = 0; r < w.rows; r++) {
      var run = [], kind = null;
      for (var c = 0; c < w.cols; c++) {
        var key = CellKey(r, c), k = stableKind(w, w.cells.get(key));
        if (k != null && k === kind) run.push(key);
        else { absorb(run); run = (k != null) ? [key] : []; kind = k; }
      }
      absorb(run);
    }
    // vertical
    for (var cc = 0; cc < w.cols; cc++) {
      var vrun = [], vkind = null;
      for (var rr = 0; rr < w.rows; rr++) {
        var vkey = CellKey(rr, cc), vk = stableKind(w, w.cells.get(vkey));
        if (vk != null && vk === vkind) vrun.push(vkey);
        else { absorb(vrun); vrun = (vk != null) ? [vkey] : []; vkind = vk; }
      }
      absorb(vrun);
    }
    return { cells: cellsHit, gemIds: gemIds };
  }

  // A gem is movable if it's SEATED and not pinned (obstacles pin later).
  function movable(g) { return g && g.state === 'SEATED'; }

  // An INLET is an active cell fed by open sky — its straight upstream is off the
  // board. For uniform down-flow that is exactly the active top-row cells. (Painted
  // inlets and starved-pocket promotion are later refinements.) A single apex
  // inlet feeds a whole pyramid via diagonal slip — Engine 1's pyramid rhythm.
  function isInlet(w, cell) {
    if (!cell.active) return false;
    var up = upstreamOf(cell);
    if (!up) return false;
    return !w.cells.has(CellKey(up[0], up[1]));   // nothing above on the board = open sky
  }

  // Bring a NEW gem into an empty inlet, sliding in from just above the board.
  // `from` is a virtual off-board key (row -1); nothing dereferences it as a
  // cell — it only positions the fly-in — so no phantom cell is created.
  function spawnGem(w, cell) {
    var id = 'g' + (++w.gidSeq);
    var kind = SPAWN_KINDS[Math.floor(w.rng() * SPAWN_KINDS.length)];
    w.gems.set(id, { id: id, kind: kind, state: 'SLIDING', home: CellKey(cell.r, cell.c),
                     from: CellKey(cell.r - 1, cell.c), to: CellKey(cell.r, cell.c), p: 0, vel: ENTRY });
    cell.reservedBy = id;
    cell.emptyFor = 0;
  }

  // Launch a donor gem SLIDING from its cell into `cell` (straight or diagonal).
  function launch(w, donorCell, donor, cell) {
    donorCell.occupant = null;
    donorCell.emptyFor = 0;            // just vacated — the gem above it must now wait STAGGER
    cell.reservedBy = donor.id;
    donor.state = 'SLIDING';
    donor.from = CellKey(donorCell.r, donorCell.c);
    donor.to = CellKey(cell.r, cell.c);
    donor.p = 0;
    if (donor.vel === 0) donor.vel = ENTRY;   // beginning a fall from rest
  }

  // Can this cell's gem fall straight (is the cell directly downstream open)?
  function canFallStraight(w, cell) {
    var d = downstreamOf(cell);
    if (!d) return false;
    var dc = w.cells.get(CellKey(d[0], d[1]));
    return !!(dc && dc.active && dc.occupant == null && dc.reservedBy == null);
  }

  // Is `cell`'s STRAIGHT feed blocked forever by a hole? Walk up the flow axis
  // past empty active cells: a hole ⇒ blocked (slip around it); open sky above,
  // or any occupied/reserved cell ⇒ a straight feed is coming, so no slip. This
  // is what stops a gem slipping when it could simply fall straight.
  function straightFeedBlocked(w, cell) {
    var up = upstreamOf(cell);
    if (!up) return false;
    var r = up[0], c = up[1];
    for (;;) {
      var uc = w.cells.get(CellKey(r, c));
      if (!uc) return false;                                 // off-board = open sky
      if (!uc.active) return true;                           // a hole = blocked forever
      if (uc.occupant != null || uc.reservedBy != null) return false; // straight feed coming
      var nxt = upstreamOf(uc);                              // empty active: keep walking up
      if (!nxt) return false;
      r = nxt[0]; c = nxt[1];
    }
  }

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

    // 2. GRAVITY. First advance the empty-clock: a cell empty and unreserved
    // this tick ages; anything occupied or reserved is reset to 0, so when it
    // next empties it starts its stagger fresh. This clock is the accordion.
    for (var cc of w.cells.values()) {
      if (cc.active && cc.occupant == null && cc.reservedBy == null) cc.emptyFor += dt;
      else cc.emptyFor = 0;
    }
    // Then pull: each active, empty, unreserved cell that has waited its STAGGER
    // pulls ONE upstream donor. Bottom-rows-first so a lower hole fills before
    // the cell above becomes a donor: one launch per gem.
    var order = [...w.cells.values()].sort(function (a, b) { return b.r - a.r; });
    for (var cell of order) {
      if (!cell.active || cell.occupant != null || cell.reservedBy != null) continue;
      if (cell.emptyFor < STAGGER) continue;         // hasn't waited its turn — the accordion
      var up = upstreamOf(cell);
      if (!up) continue;
      var donorCell = w.cells.get(CellKey(up[0], up[1]));
      if (!donorCell || !donorCell.active) continue;
      var donor = donorCell.occupant != null ? w.gems.get(donorCell.occupant) : null;
      if (!movable(donor)) continue;
      launch(w, donorCell, donor, cell);
    }

    // 2b. DIAGONAL SLIP (Engine 1's second-most-important rule). A cell whose
    // straight feed is blocked FOREVER by a hole is fed from a diagonal-upstream
    // donor instead — this is what makes gems flow AROUND notches and holes
    // rather than leaving dead gaps under them. Rules ported exactly: the donor
    // must be RESTING (cannot fall straight, or it would just do that), in the
    // receiver's OWN region (no pocket leakage), and reached by slipping around
    // the hole. Runs after the straight phase, on cells the straight phase left
    // empty. No holes on a board ⇒ this phase does nothing (down-only levels
    // behave identically), so it never disturbs scenarios 1–3.
    for (var rc2 of order) {
      if (!rc2.active || rc2.occupant != null || rc2.reservedBy != null) continue;
      if (rc2.emptyFor < STAGGER) continue;
      if (!straightFeedBlocked(w, rc2)) continue;            // a straight/spawn feed is coming — no slip
      var up2 = upstreamOf(rc2);
      if (!up2) continue;
      // the two cells flanking the upstream, perpendicular to the feed axis
      var perp = (rc2.flow === 'down' || rc2.flow === 'up')
        ? [[up2[0], up2[1] - 1], [up2[0], up2[1] + 1]]
        : [[up2[0] - 1, up2[1]], [up2[0] + 1, up2[1]]];
      for (var pi = 0; pi < perp.length; pi++) {             // deterministic order (I9); seeded pick is a later refinement
        var dk = CellKey(perp[pi][0], perp[pi][1]), dCell = w.cells.get(dk);
        if (!dCell || !dCell.active || dCell.occupant == null) continue;
        if (dCell.region !== rc2.region) continue;           // own region only
        var dGem = w.gems.get(dCell.occupant);
        if (!dGem || dGem.state !== 'SEATED') continue;
        if (canFallStraight(w, dCell)) continue;             // resting only — if it can fall straight, it does
        launch(w, dCell, dGem, rc2);
        break;
      }
    }

    // 3. SPAWN — an empty open-sky inlet pulls a NEW gem in from off-board.
    // Stagger-gated like every other fill, so refill obeys the accordion. Off
    // when w.spawns is false (the settle-checking scenarios leave it off).
    if (w.spawns) {
      for (var si of order) {
        if (!isInlet(w, si) || si.occupant != null || si.reservedBy != null) continue;
        if (si.emptyFor < STAGGER) continue;
        spawnGem(w, si);
      }
    }

    // 4. MATCH — 3+ runs among stable seated gems only (key rule via stableKind).
    var m = findMatches(w);

    // 5. RESOLVE — clear exactly the matched cells. cleared IS matched, by
    // construction: there is no second coordinate list that could drift from the
    // match set, which is what makes the phantom clear (I4) unwritable here.
    if (m.cells.size) {
      trace.matched = [...m.cells];
      trace.matchedGemIds = [...m.gemIds];
      for (var key of m.cells) {
        var cl = w.cells.get(key);
        if (cl.occupant != null) { w.gems.delete(cl.occupant); cl.occupant = null; }
        cl.emptyFor = 0;               // a just-popped cell also waits — the beat after a clear
      }
      trace.cleared = [...m.cells];        // literally the same set — I4 holds
    }

    // 6. INPUT — swaps are applied by applySwap() between ticks; nothing here.

    return trace;
  }

  // ── quiescence is DERIVED (invariant I7), never remembered. A board is quiet
  // only when NOTHING is in flight, NOTHING can still fall, and NOTHING matches.
  // The "can still fall" clause matters now that the accordion delays a launch:
  // a gem waiting out its stagger is not sliding yet, but the board is plainly
  // not at rest — omitting this made the driver stop before the first drop.
  function anySliding(w) { for (var g of w.gems.values()) if (g.state === 'SLIDING') return true; return false; }
  function canFall(w) {
    for (var cell of w.cells.values()) {
      if (!cell.active || cell.occupant != null || cell.reservedBy != null) continue;
      var up = upstreamOf(cell);
      if (!up) continue;
      // a straight donor waiting above?
      var dc = w.cells.get(CellKey(up[0], up[1]));
      if (dc && dc.active && dc.occupant != null) {
        var g = w.gems.get(dc.occupant);
        if (g && g.state === 'SEATED') return true;
      }
      // or a diagonal slip pending (straight feed blocked, a resting diagonal
      // donor in region)? Without this a slip-only cell reads as "at rest" and
      // the loop stops before the gem slips — the diagonal twin of the accordion
      // quiescence fix.
      if (straightFeedBlocked(w, cell)) {
        var perp = (cell.flow === 'down' || cell.flow === 'up')
          ? [[up[0], up[1] - 1], [up[0], up[1] + 1]]
          : [[up[0] - 1, up[1]], [up[0] + 1, up[1]]];
        for (var i = 0; i < perp.length; i++) {
          var pc = w.cells.get(CellKey(perp[i][0], perp[i][1]));
          if (pc && pc.active && pc.occupant != null && pc.region === cell.region) {
            var pg = w.gems.get(pc.occupant);
            if (pg && pg.state === 'SEATED' && !canFallStraight(w, pc)) return true;
          }
        }
      }
    }
    return false;
  }
  // A refill is pending if any inlet stands empty (spawns on) — the board plainly
  // isn't at rest, so quiescence must include it, same as canFall.
  function anyPendingSpawn(w) {
    if (!w.spawns) return false;
    for (var cell of w.cells.values())
      if (cell.occupant == null && cell.reservedBy == null && isInlet(w, cell)) return true;
    return false;
  }
  function isQuiet(w, hasSeatedMatch) {
    return !anySliding(w) && !canFall(w) && !anyPendingSpawn(w) && !hasSeatedMatch;
  }

  // Whether a match currently exists among stable seated gems — the second half
  // of quiescence (I7). Derived, never cached.
  function hasMatch(w) { return findMatches(w).cells.size > 0; }

  // applySwap — the only way input mutates the board. Swaps two adjacent SEATED
  // stable gems; returns whether it was accepted (invariant I8's legality is this
  // predicate). The caller ticks afterward; a resulting match resolves in MATCH.
  function applySwap(w, ka, kb) {
    var a = w.cells.get(ka), b = w.cells.get(kb);
    var seatedStable = function (cell) {
      if (!cell || cell.occupant == null || cell.reservedBy != null) return false;
      var g = w.gems.get(cell.occupant);
      return g && g.state === 'SEATED';
    };
    var adjacent = a && b && (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1);
    if (!seatedStable(a) || !seatedStable(b) || !adjacent) return false;
    var ga = w.gems.get(a.occupant), gb = w.gems.get(b.occupant);
    a.occupant = gb.id; b.occupant = ga.id;
    ga.home = kb; gb.home = ka;
    return true;
  }

  var api = { CellKey: CellKey, makeWorld: makeWorld, tick: tick,
              applySwap: applySwap, hasMatch: hasMatch,
              isQuiet: isQuiet, anySliding: anySliding, canFall: canFall,
              anyPendingSpawn: anyPendingSpawn,
              constants: { ENTRY: ENTRY, ACCEL: ACCEL, TERMINAL: TERMINAL, STAGGER: STAGGER } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CellEngine = api; root.CellKey = CellKey; }
})(typeof window !== 'undefined' ? window : globalThis);
