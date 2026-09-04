/* ══════════════════════════════════════════════════════════════════════════
   CLEAR TRIPWIRE — records every gem removal during play, so that as the
   Engine-2 commits are cherry-picked ONE AT A TIME, the exact commit that first
   clears a cell it shouldn't is caught WITH EVIDENCE — the move, the cell, the
   cause, and whether a real match even existed — instead of being discovered
   three commits later and guessed at.

   This is a test instrument, NOT engine code: it monkey-patches the single clear
   choke point (clearCell) and the shatter VFX (spawnFragments) at runtime. It
   touches nothing the cherry-picks touch, so no commit can break it and it can't
   change engine behaviour. Arm it after the engine loads:

       fetch('/editor/tests/clear-tripwire.js').then(r=>r.text()).then(eval);

   Then play. Inspect:
       window.__clearLog     every gem removal {move,r,c,gem,via,runInSnap}
       window.__phantoms()   MATCH-path clears with NO real run behind them
       window.__vfxOnly()    shatter VFX fired on a cell that was never cleared
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__tripwireArmed) { return 'already armed'; }
  window.__clearLog = [];
  window.__vfxLog = [];
  // Per clearing PASS, snapshot the board the FIRST time we see that phaseSet, so a
  // cell's "was there a real run behind this clear?" is judged against the board as
  // it was BEFORE the pass started nulling its run-mates (checking live would fail
  // the moment the first mate is gone). A stale/mis-indexed clear — the phantom's
  // signature — has no run even in that pre-clear snapshot.
  var passSnap = new WeakMap();
  function snap() {
    var g = [];
    for (var r = 0; r < R; r++) { var row = []; for (var c = 0; c < C; c++) row.push(board[r][c].gem); g.push(row); }
    return g;
  }
  function runThrough(g, r, c, val) {
    if (val == null || !g[r] || g[r][c] !== val) return false;
    function len(dr, dc) {
      var n = 1, rr = r + dr, cc = c + dc;
      while (g[rr] && g[rr][cc] === val) { n++; rr += dr; cc += dc; }
      rr = r - dr; cc = c - dc;
      while (g[rr] && g[rr][cc] === val) { n++; rr -= dr; cc -= dc; }
      return n;
    }
    return len(0, 1) >= 3 || len(1, 0) >= 3;
  }
  // The cause of a clear, read off the call stack: a detonation (power-up blast)
  // clears NON-matched cells legitimately; the match/sweep path must only clear
  // real runs. Separating them is what makes a phantom a phantom.
  function cause() {
    var s = (new Error()).stack || '';
    if (/clearCellD|processDetonations|detHopper|detScarab|grasshopper|scarab|rocket|rainbow|\bbomb\b/i.test(s)) return 'detonation';
    if (/boardQuiet/i.test(s)) return 'sweep';
    if (/\bresolve\b/i.test(s)) return 'match';
    return 'other';
  }

  var _clearCell = clearCell;
  clearCell = function (r, c, phaseSet) {
    try {
      var val = (board[r] && board[r][c]) ? board[r][c].gem : null;
      if (val != null) {
        if (phaseSet && !passSnap.has(phaseSet)) passSnap.set(phaseSet, snap());
        var g = phaseSet ? passSnap.get(phaseSet) : snap();
        window.__clearLog.push({ move: (typeof moves !== 'undefined' ? moves : -1),
          t: Math.round(performance.now()), r: r, c: c, gem: val,
          via: cause(), runInSnap: runThrough(g, r, c, val) });
      }
    } catch (e) { /* never let the instrument perturb the run */ }
    return _clearCell.call(this, r, c, phaseSet);
  };

  if (typeof spawnFragments === 'function') {
    var _frag = spawnFragments;
    spawnFragments = function (r, c, gem) {
      try { window.__vfxLog.push({ move: (typeof moves !== 'undefined' ? moves : -1), r: r, c: c, gem: gem }); } catch (e) {}
      return _frag.apply(this, arguments);
    };
  }

  // A match/sweep clear with no run behind it = the ghost-clear signature (bug 1).
  window.__phantoms = function () {
    return window.__clearLog.filter(function (e) { return (e.via === 'match' || e.via === 'sweep') && !e.runInSnap; });
  };
  // Shatter VFX on a cell that no clear ever removed = the visual-only phantom (bug 2).
  window.__vfxOnly = function () {
    var cleared = new Set(window.__clearLog.map(function (e) { return e.move + ':' + e.r + ',' + e.c; }));
    return window.__vfxLog.filter(function (v) { return !cleared.has(v.move + ':' + v.r + ',' + v.c); });
  };
  window.__tripwireReset = function () { window.__clearLog.length = 0; window.__vfxLog.length = 0; };

  window.__tripwireArmed = true;
  return 'tripwire armed';
})();
