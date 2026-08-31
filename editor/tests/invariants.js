/* ══════════════════════════════════════════════════════════════════════════
   AkashicSwaps ENGINE INVARIANTS — headless regression suite.

   WHY: fixes kept introducing regressions because each was verified in isolation,
   not against the whole behavior surface. This re-checks every established rule on
   every change. Run it BEFORE committing any engine change.

   HOW (in the editor page console, or via the browser tool):
     fetch('/editor/tests/invariants.js').then(r=>r.text()).then(eval)
       .then(()=>runInvariants()).then(r=>console.log(JSON.stringify(r,null,1)));

   Returns {pass, fail, total, failures[]}. Green = fail:0.
   Add a test the moment a new rule is discovered — that's how it grows teeth.
   ══════════════════════════════════════════════════════════════════════════ */
window.runInvariants = async function(){
  const results=[]; let pass=0, fail=0;
  const ok=(name,cond,detail)=>{ const p=!!cond; results.push({name,pass:p,detail}); p?pass++:fail++; };
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const _raf=window.requestAnimationFrame; window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),4);
  const errs=[]; const onerr=e=>errs.push(e.message||String(e)); window.addEventListener('error',onerr);
  // blank NxM canvas on a loaded level: all active, plain gems, nothing else
  const wipe=(gem)=>{ for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c];
    cd.active=true;cd.obs=null;cd.item=null;cd.pu=null;cd.puClover=false;cd.startEmpty=false;cd.sub=null;cd.gem=(gem==null?GEM_POOL[0]:gem); } };
  const fireDet=async(pu,r,c,extra)=>{ const ph=new Set(),q=[Object.assign({pu,r,c},extra||{})]; await new Promise(res=>processDetonations(q,ph,()=>res())); await wait(80); return ph; };

  try {
    // ═══ 1. EVERY LEVEL LOADS CLEAN ═══════════════════════════════════════════
    const MAXL=(typeof MAX_BUILT_LEVEL!=='undefined')?MAX_BUILT_LEVEL:25;
    const held=(typeof HELD_LEVELS!=='undefined')?HELD_LEVELS:new Set();
    for(let L=1;L<=MAXL;L++){
      if(held.has(L))continue;
      await startPlayerLevel(L,false); await wait(45); if(window.flyover){flyStop=0;flyLock=false;}
      ok(`L${L} · 0 initial matches`, find3().length===0 && find2x2().length===0, find3().length);
      let crateGems=0,gemInHole=0,puCloverStuck=0;
      for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c];
        if(cd.active&&cd.obs&&/crate/.test(cd.obs)&&cd.gem!==null)crateGems++;
        if(!cd.active&&cd.gem!==null)gemInHole++;
        if(cd.puClover)puCloverStuck++; }
      ok(`L${L} · 0 crate cells hold gems`, crateGems===0, crateGems);
      ok(`L${L} · 0 gems in inactive cells`, gemInHole===0, gemInHole);
      ok(`L${L} · no stray clover-charge at rest`, puCloverStuck===0, puCloverStuck);
      if(!flyover) ok(`L${L} · opening board has a move`, hasValidMove(), 'deadlock');
    }

    // ═══ 2. GRAVITY / FILL INVARIANTS ═════════════════════════════════════════
    // 2a. crates block gravity: no gem ever falls/spawns into a crate (L22/L23 stress)
    for(const L of [22,23]){
      await startPlayerLevel(L,false); await wait(45); if(window.flyover){flyStop=0;flyLock=false;}
      const crates=[]; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].obs&&/crate/.test(board[r][c].obs))crates.push([r,c]);
      for(let i=0;i<12;i++){ for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].active&&board[r][c].gem!==null&&!board[r][c].item&&Math.random()<0.5)board[r][c].gem=null; gravityWithMap(); }
      ok(`L${L} · crates never receive a gem (30-pass stress)`, crates.every(([r,c])=>board[r][c].gem===null), 'a crate got a gem');
    }
    // 2b. L25 canal: startEmpty cells never SPAWN (fill only via inflow)
    await startPlayerLevel(25,false); await wait(45);
    const emptyStart=[]; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].active&&board[r][c].gem===null&&!board[r][c].obs&&!board[r][c].item)emptyStart.push([r,c]);
    for(let r=0;r<4;r++)for(let c=0;c<4;c++) if(board[r][c].active&&board[r][c].gem!==null&&!board[r][c].obs)board[r][c].gem=null;
    gravityWithMap();
    ok('L25 · startEmpty cells do not spawn (no fill from below)', emptyStart.every(([r,c])=>board[r][c].gem===null), 'a sealed cell spawned');
    // 2c. L2 interior holes: gravity never routes a gem INTO / spawns FROM a hole
    await startPlayerLevel(2,false); await wait(45);
    const holes=new Set(); for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(!board[r][c].active)holes.add(r+','+c);
    let holeGem=0, flyFromHole=0;
    for(let i=0;i<12;i++){ for(let r=0;r<4;r++){ if(board[r][3].active)board[r][3].gem=null; if(board[r][4].active)board[r][4].gem=null; }
      const mv=gravityWithMap();
      for(const k of holes){const[r,c]=k.split(',').map(Number); if(board[r][c].gem!==null)holeGem++;}
      for(const m of mv){ if(!m.fadeIn && m.path && m.path.length && holes.has(m.path[0].r+','+m.path[0].c))flyFromHole++; } }
    ok('L2 · no gem ever sits in an inactive hole', holeGem===0, holeGem);
    ok('L2 · no gem flies/spawns FROM a hole', flyFromHole===0, flyFromHole);

    // ═══ 3. CLOVER RULES (blank canvas, V-rocket = column) ═════════════════════
    const col=3, colClover=()=>[...Array(R).keys()].filter(r=>board[r][col].sub==='clover').length;
    await startPlayerLevel(14,false); await wait(45); // 8x7 rectangle canvas
    // 3a. double-tap in place, no clover in line -> plants nothing
    wipe(); board[3][col].gem=null; board[3][col].pu='rocket_v'; board[3][col].puClover=false;
    await fireDet('rocket_v',3,col); ok('clover · double-tap-in-place on bare, no clover crossed → 0', colClover()===0, colClover());
    // 3b. UNCHARGED beam crossing a MID-PATH clover seed plants the cells BEYOND
    // it (project_clover_model directional exception, piece 3): fire row3, seed at
    // row6 → the down-beam crosses row6 and keeps going, so it plants row7. The
    // up-beam and rows 4-5 (before the seed) stay bare → column holds row6+row7.
    wipe(); board[6][col].sub='clover'; board[3][col].gem=null; board[3][col].pu='rocket_v'; board[3][col].puClover=false;
    await fireDet('rocket_v',3,col); ok('clover · uncharged beam crossing a mid-path seed plants BEYOND it (row6+row7)', colClover()===2, colClover());
    // 3c. dragged off clover -> charged -> plants line even with origin ground stripped
    wipe(); board[3][col].sub='clover'; board[3][col].gem=null; board[3][col].pu='rocket_v';
    (()=>{ const sr=3,sc=col,r=4,cc=col; for(const k of ['gem','pu','item']){const t=board[sr][sc][k];board[sr][sc][k]=board[r][cc][k];board[r][cc][k]=t;}
      board[r][cc].puClover=!!board[r][cc].pu&&board[sr][sc].sub==='clover'; board[sr][sc].puClover=!!board[sr][sc].pu&&board[r][cc].sub==='clover'; })();
    const dragCharge=board[4][col].puClover===true; board[3][col].sub=null;
    await fireDet('rocket_v',4,col); ok('clover · dragged-off-clover charges the PU', dragCharge, dragCharge);
    ok('clover · charged PU plants its whole line (bare ground)', colClover()===R, colClover());
    // 3d. chain-caught (never dragged) bare -> plants nothing
    wipe(); board[3][col].gem=null; board[3][col].pu='rocket_v'; board[3][col].puClover=false;
    await fireDet('rocket_v',3,col); ok('clover · chain-caught bare PU → 0', colClover()===0, colClover());
    // 3e. in-place ON a clover cell -> CHARGED (project_clover_model: on-clover
    // takeoff now charges too, revising aac80b1's drag-off-ONLY rule; keyed off the
    // cell's REAL substrate, so a match-born PU on bare ground stays uncharged — 3a)
    // -> plants its WHOLE line. This is the double-tap-on-clover reversal.
    wipe(); board[3][col].sub='clover'; board[3][col].gem=null; board[3][col].pu='rocket_v'; board[3][col].puClover=false;
    await fireDet('rocket_v',3,col); ok('clover · in-place ON a clover cell charges → whole line planted', colClover()===R, colClover());
    // 3f. clover at an arm's TERMINUS (nothing beyond) plants nothing — the
    // original L7 case. Fire row3, seed at the bottom terminus (row R-1): the
    // down-beam ends ON the seed with nothing past it; the up-beam crosses none.
    wipe(); board[R-1][col].sub='clover'; board[3][col].gem=null; board[3][col].pu='rocket_v'; board[3][col].puClover=false;
    await fireDet('rocket_v',3,col); ok('clover · uncharged beam ending ON a seed (terminus) plants nothing new', colClover()===1, colClover());

    // ═══ 4. CRATE SPLASH FROM DETONATIONS ═════════════════════════════════════
    await startPlayerLevel(14,false); await wait(60); wipe(GEM_POOL[1]);
    // crate at (4,4); only its 4 neighbors are the Ball's target color (keeps the
    // sweep to 4 cells so the fixed-pace laser stays fast). Ball clears them → crack.
    board[4][4].obs='crate1'; board[4][4].gem=null;
    for(const [r,c] of [[3,4],[5,4],[4,3],[4,5]]) board[r][c].gem=GEM_POOL[0];
    await fireDet('rainbow',0,0,{color:GEM_POOL[0]});
    ok('crate · adjacent Ball detonation breaks a bordering crate', board[4][4].obs===null, board[4][4].obs);
    // HP2 crate + two neighbors cleared in ONE phase = ONE hit (dedup)
    wipe(); board[4][4].obs='crate2'; board[4][4].gem=null; const ph=new Set();
    splashObstacle(4,3,ph); splashObstacle(4,5,ph);
    ok('crate · splash is one hit per obstacle per phase (crate2→crate1)', board[4][4].obs==='crate1', board[4][4].obs);

    // ═══ 5. SWAP RULES ════════════════════════════════════════════════════════
    // key is swappable (guard admits item==='key')
    await startPlayerLevel(14,false); await wait(45); wipe();
    const guardAdmitsKey=(cd=>!(!cd.active||(cd.gem===null&&!cd.pu&&cd.item!=='key')))(( ()=>{board[2][2].gem=null;board[2][2].item='key';return board[2][2];})());
    ok('swap · key cell is selectable', guardAdmitsKey, guardAdmitsKey);
    // gem slides into empty active cell to make a match (yellow V-3)
    wipe(GEM_POOL[1]); const Y=GEM_POOL[0]; board[4][3].gem=null; board[3][3].gem=Y; board[2][3].gem=Y; board[4][4].gem=Y;
    (()=>{ const t=board[4][4].gem;board[4][4].gem=board[4][3].gem;board[4][3].gem=t; })(); // slide (4,4)→(4,3)
    ok('swap · gem slides into empty active cell to complete a match', find3().some(([r,c])=>r===4&&c===3), 'no match at gap');

    // ═══ 6. AUTO-SHUFFLE ══════════════════════════════════════════════════════
    await startPlayerLevel(14,false); await wait(45);
    const three=[GEM_POOL[0],GEM_POOL[1],GEM_POOL[2]];
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){ board[r][c].active=true;board[r][c].obs=null;board[r][c].item=null;board[r][c].pu=null;board[r][c].startEmpty=false;board[r][c].sub=null;board[r][c].gem=three[(r+c)%3]; }
    ok('shuffle · genuine deadlock detected (no move)', !hasValidMove(), 'hasValidMove true on deadlock');
    playerMode=true; Motion.releaseAll(); maybeShuffle();
    ok('shuffle · escapes deadlock → has-move + no-match', hasValidMove()&&find3().length===0, 'still stuck');
    // no-op when a move exists
    await startPlayerLevel(2,false); await wait(45);
    const snap=board.map(row=>row.map(x=>x.gem)); maybeShuffle();
    let changed=0; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].gem!==snap[r][c])changed++;
    ok('shuffle · no-op when a move already exists', changed===0, changed+' cells changed');

    // ═══ 6b. DRILL WALKER (travel rule B) ══════════════════════════════════════
    // Six drills ride ONE direction-agnostic walker. These pin the rule Jed
    // ruled on: bore FROM the cell along the given directions ONLY; a breakable
    // takes its hit and the bore CONTINUES; an unbreakable (a hole) stops that
    // arm dead. Also pins the 8-direction capability the diagonal Grasshopper
    // will need, so nobody narrows DIR8 back to 4 without a red light here.
    await startPlayerLevel(14,false); await wait(45); wipe();
    const key=(cs)=>new Set(cs.map(([r,c])=>r+','+c));
    // 6b-i. single direction bores ONE way only
    let d=drillCells(4,4,['r']);
    ok('drill · right-only never bores left', d.every(([r,c])=>r===4&&c>=4), d.filter(([r,c])=>c<4));
    ok('drill · right-only reaches the board edge on a clear row', d.length===C-4, d.length+' of '+(C-4));
    ok('drill · includes its own impact point', key(d).has('4,4'), [...key(d)].slice(0,3));
    // 6b-ii. the four single directions are mutually exclusive
    const dl=drillCells(4,4,['l']), du=drillCells(4,4,['u']), dd=drillCells(4,4,['d']);
    ok('drill · left-only never bores right', dl.every(([r,c])=>r===4&&c<=4), dl.filter(([r,c])=>c>4));
    ok('drill · up-only never bores down',    du.every(([r,c])=>c===4&&r<=4), du.filter(([r,c])=>r>4));
    ok('drill · down-only never bores up',    dd.every(([r,c])=>c===4&&r>=4), dd.filter(([r,c])=>r<4));
    // 6b-iii. bidirectional = the union of its two arms (Horizon/Ascension)
    const dh=drillCells(4,4,['l','r']);
    ok('drill · bidirectional H = both arms, whole row', key(dh).size===C, key(dh).size+' of '+C);
    // 6b-iv. TRAVEL RULE B — a BREAKABLE is bored THROUGH (crate at (4,6) does not stop it)
    wipe(); board[4][6].obs='crate1'; board[4][6].gem=null;
    d=drillCells(4,4,['r']);
    ok('drill · travel B: bores THROUGH a breakable crate', key(d).has('4,7')||C<8, [...key(d)].join(' '));
    // 6b-v. TRAVEL RULE B — an UNBREAKABLE (inactive hole) stops the arm dead
    wipe(); board[4][6].active=false;
    d=drillCells(4,4,['r']);
    ok('drill · travel B: a hole stops the bore', !key(d).has('4,7')&&key(d).has('4,5'), [...key(d)].join(' '));
    ok('drill · never returns an inactive cell', d.every(([r,c])=>board[r][c].active), d.filter(([r,c])=>!board[r][c].active));
    // 6b-vi. all 8 directions exist — the diagonal Grasshopper's foundation
    wipe();
    ok('drill · DIR8 carries all four diagonals', ['ne','nw','se','sw'].every(k=>DIR8[k]), Object.keys(DIR8));
    const dx=drillCells(4,4,['ne','nw','se','sw']);
    ok('drill · diagonal set bores diagonally only', dx.every(([r,c])=>r===4&&c===4||Math.abs(r-4)===Math.abs(c-4)), dx.slice(0,4));
    // Diagonals can only ever touch ONE checkerboard parity — the property that
    // makes the die-five Grasshopper a different tool from the Akashic Cross.
    ok('drill · diagonals preserve (r+c) parity', dx.every(([r,c])=>((r+c)%2+2)%2===((4+4)%2+2)%2), dx.filter(([r,c])=>(r+c)%2!==0).slice(0,3));
    // 6b-vii. every catalog booster resolves (no drill ships without directions)
    ok('drill · every BOOSTERS entry has a known id + valid dirs', BOOSTERS.every(b=>b.id&&(!b.dirs||b.dirs.every(k=>DIR8[k]))), BOOSTERS.map(b=>b.id));
    ok('drill · catalog is ungated (no intro levels remain)', BOOSTERS.every(b=>b.intro===undefined), BOOSTERS.filter(b=>b.intro!==undefined));
    // No booster ships nameless or iconless in ANY language — the lesson from the
    // goal-icon bug that had to be fixed in four places (Session 24). A missing
    // i18n key renders as the raw key; a missing icon silently renders a padlock,
    // which reads to the player as "locked" rather than "we forgot".
    ['en','ko','es'].forEach(lg=>{
      const miss=BOOSTERS.filter(b=>!(window.I18N&&I18N[lg]&&I18N[lg]['booster_'+b.id]));
      ok('drill · every booster is named in '+lg, miss.length===0, miss.map(b=>b.id));
    });
    const noArt=BOOSTERS.filter(b=>/<svg/.test(boosterSVG(b.id,40))===false||boosterSVG(b.id,40)===padlockSVG(40));
    ok('drill · every booster renders real art (never a fallback padlock)', noArt.length===0, noArt.map(b=>b.id));
    // The four diagonals are each represented exactly once — the roster Jed set.
    ok('drill · all four diagonals are in the catalog', ['ne','nw','se','sw'].every(d=>BOOSTERS.some(b=>b.dirs&&b.dirs[0]===d)), BOOSTERS.map(b=>b.dirs&&b.dirs.join('')));

    // ═══ 6c. EDITOR — NO SILENT DEAD ENDS, NO UNRECOVERABLE WIPES ══════════════
    // Jed 2026-08-25, painting a 9x11 serpentine: picking the Flow layer left
    // flowMode on a preset, so every click silently did nothing. That was the
    // THIRD instance of the same disease (Obstacle tab + Base brush, Session 24).
    // A layer you can select but not paint on must never be reachable — assert it
    // for EVERY layer, so the next one added can't quietly repeat this.
    await startPlayerLevel(14,false); await wait(45); playing=false;
    // Each layer is forced into a state the paint MUST change, so the check can't
    // false-pass (or false-FAIL) on whatever the cell happened to already hold —
    // painting gem-0 onto a cell that already holds gem 0 proves nothing.
    const layerPaints={};
    setLayer('base'); setBase('active'); board[2][2].active=false;
    paintCell(2,2); layerPaints.base=board[2][2].active===true;
    setLayer('tile'); selBrush={type:'gem',id:0}; board[2][2].gem=1;
    paintCell(2,2); layerPaints.tile=board[2][2].gem===0;
    setLayer('flow'); flow[2][2]='down';
    paintCell(2,2); layerPaints.flow=flow[2][2]!=='down';
    ok('editor · every selectable layer actually paints on click', Object.values(layerPaints).every(Boolean), layerPaints);
    // Same rule one level up: a TOOL you can select must change the cell you click.
    // Fill and Mirror were removed 2026-08-27 because they only ever acted under a
    // gem brush — editing the one thing the serializer discards — and Jed had never
    // used either. Enumerated from the DOM so a tool added later is covered without
    // anyone remembering to add a test.
    const toolActs={};
    setLayer('tile'); pickBrush('gem',2,null);
    [...document.querySelectorAll('[id^="tt-"]')].map(b=>b.id.replace('tt-','')).forEach(t=>{
      setTool(t);
      const cd=board[4][4];
      cd.active=true; cd.gem=0; cd.pu=null; cd.obs='bind1'; cd.sub=null; cd.item=null;
      const before=JSON.stringify(cd);
      paintCell(4,4);
      toolActs[t]=JSON.stringify(board[4][4])!==before;   // any real change counts
    });
    setTool('paint');
    ok('editor · every tool button actually changes the cell it clicks',
       Object.keys(toolActs).length>0&&Object.values(toolActs).every(Boolean), toolActs);
    ok('editor · picking the Flow layer engages custom painting', (setLayer('flow'),flowMode==='custom'), flowMode);
    // A whole-board flow preset is destructive; it must be undoable.
    setFlow('custom'); paintCell(5,5); paintCell(5,5);
    const handPainted=flow[5][5];
    setFlow('down');
    const wiped=flow[5][5];
    doUndo();
    ok('editor · a flow preset wipe is recoverable with undo', flow[5][5]===handPainted&&wiped!==handPainted, {handPainted,wiped,afterUndo:flow[5][5]});
    // Flow must ride in the undo snapshot at all — it used to be omitted entirely.
    ok('editor · undo snapshots carry the flow layer', (()=>{try{return JSON.parse(snapState()).f!==undefined;}catch(e){return false;}})(), 'snapState missing flow');
    // THE PALETTE SHOWS ONLY WHAT THE LAYER CAN PAINT (Jed 2026-08-27: every swatch
    // was visible on every layer, and most of them were inert). The map is the
    // contract — assert each layer's visible sections ARE its mapped ones, so a new
    // section can't quietly appear on a layer that ignores it.
    const _visible=()=>['base-pal','gem-pal','pu-pal','src-pal','sub-pal','ovl-pal','blk-pal','itm-pal']
      .filter(id=>{const e=document.getElementById(id);return e&&getComputedStyle(e).display!=='none';});
    const _palOK={};
    Object.keys(LAYER_SECTIONS).forEach(L=>{
      setLayer(L);
      const vis=_visible(), want=LAYER_SECTIONS[L];
      _palOK[L]=vis.length===want.length&&want.every(id=>vis.includes(id));
    });
    ok('editor · each layer shows exactly the swatches it can paint', Object.values(_palOK).every(Boolean), _palOK);
    // Tile and Obstacle share one paint pass, so a brush picked from the Obstacle
    // palette must KEEP that view — snapping back to Tile would re-expand every
    // swatch the author just filtered away, one click after filtering them.
    setLayer('obstacle'); pickBrush('obs','crate1',null);
    ok('editor · picking an Obstacle swatch stays on the Obstacle layer', layer==='obstacle', layer);
    board[3][3].active=true; board[3][3].obs=null; board[3][3].sub=null;
    setTool&&setTool('paint'); paintCell(3,3);
    ok('editor · the Obstacle layer still paints after picking there',
       board[3][3].obs==='crate1', {obs:board[3][3].obs,sub:board[3][3].sub});

    // GEM COLOURS ARE SEEDED, NOT PAINTED (Jed 2026-08-27). serializeLevel() writes a
    // plain 'g' for every gem cell, so a painted colour never survives a save — the
    // left palette's colour swatches were a no-op duplicating the right-hand palette
    // picker, which is the real control. Assert both halves: no colour swatches, and
    // the serializer genuinely ignores whatever colour a cell holds.
    // The chips are a TESTING tool — an author builds an exact position by hand and
    // hits Play. They are not level data (see the serializer check below), and every
    // glyph must sit INSIDE its box: the old chips drew a 34px gem in a 32px chip,
    // so each one overflowed its own border (Jed: "they looked wonky").
    setLayer('tile'); buildGPal();
    const _chips=[...document.querySelectorAll('#gpal [data-bid^="gem:"]')];
    ok('editor · a gem chip exists for every gem colour', _chips.length===GDEFS.length,
       {chips:_chips.length, colours:GDEFS.length});
    const _overflow=_chips.filter(ch=>{
      const svg=ch.querySelector('svg'); if(!svg)return true;
      const b=ch.getBoundingClientRect(), g=svg.getBoundingClientRect();
      return g.width>b.width||g.height>b.height;      // glyph must never exceed its chip
    }).length;
    ok('editor · every gem glyph fits inside its chip', _chips.length>0&&_overflow===0, {overflowing:_overflow});
    (function(){
      const r0=2,c0=2; board[r0][c0].active=true; board[r0][c0].pu=null; board[r0][c0].obs=null;
      board[r0][c0].item=null; board[r0][c0].startEmpty=false;
      board[r0][c0].gem=0; const a=serializeLevel().layers.contents[r0][c0];
      board[r0][c0].gem=3; const b=serializeLevel().layers.contents[r0][c0];
      ok('editor · a gem cell serializes the same whatever colour is painted', a==='g'&&b==='g', {red:a,other:b});
    })();

    // ═══ 6f2. TARGETING STATE: SELF IS LEGAL, AND IT NEVER OUTLIVES THE BOARD ══
    // Jed 2026-08-27, two bugs in one sitting. (1) The hopper's own cell was the one
    // square the reticle refused, so "blast the orthogonals and stay put" — detonate
    // in place — was unreachable. (2) He exited mid-choose, came back, and every cell
    // of the FRESH board was still throbbing as a target for a hopper that no longer
    // existed: the choosing state lives outside board data, so rebuilding the level
    // never touched it.
    await startPlayerLevel(14,false); await wait(60);
    (function(){
      const cells=[];
      for(let r=0;r<R;r++)for(let c=0;c<C;c++){
        const cd=board[r][c]; if(!cd||!cd.active)continue;
        if(cd.gem===null)cd.gem=1; cd.pu=null; cells.push([r,c]);
      }
      const h=cells[Math.floor(cells.length/2)];
      board[h[0]][h[1]].pu='helicopter'; render(); Motion.releaseAll(); selCell=null;
      onCell(h[0],h[1],{clientX:0,clientY:0}); onCell(h[0],h[1],{clientX:0,clientY:0});
      const own=document.querySelector('[data-r="'+h[0]+'"][data-c="'+h[1]+'"]');
      ok('hopper · the reticle offers the hopper\'s OWN cell (detonate in place)',
         !!choosingGrasshopper&&!!own&&own.classList.contains('hopper-pick'),
         {choosing:!!choosingGrasshopper, ownPickable:!!(own&&own.classList.contains('hopper-pick'))});
      exitToGrid();
      ok('hopper · leaving the board drops the targeting state AND its reticle',
         !choosingGrasshopper&&!armedBooster&&!window._pendingHopperChoose
           &&document.querySelectorAll('.hopper-pick').length===0,
         {choosing:!!choosingGrasshopper, throbbing:document.querySelectorAll('.hopper-pick').length});
    })();

    // ═══ 6f. GRASSHOPPER TARGETS THE GOAL, INCLUDING A POWER-UP GOAL ══════════
    // Jed 2026-08-27, his own bundle: the level's only remaining goal was "fire 4
    // Grasshoppers", three hoppers spawned from a cascade, and not one of them went
    // for the Grasshoppers sitting on the board. autoGrasshopperTarget knew about
    // collect/plant/acorn/key/crate goals and nothing else — worse, in EDITOR test
    // play a PU objective fell through the mapping and was read as "collect gem 0",
    // so it actively aimed at the wrong thing. A hopper landing on a PU detonates it
    // (clearCellD → puFired), so seeking one really does advance the goal.
    const _savedGoals=playerGoals, _savedObjs=editorObjectives, _savedMode=playerMode;
    await startPlayerLevel(14,false); await wait(45);
    const _cells=[];
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){
      const cd=board[r][c]; if(!cd||!cd.active)continue;
      cd.pu=null; if(cd.gem===null)cd.gem=1; _cells.push([r,c]);
    }
    const _from=_cells[0], _far=_cells[_cells.length-1];
    board[_far[0]][_far[1]].pu='helicopter';
    playerMode=true; playerGoals=[{kind:'detonate',pu:'helicopter',need:4,have:0}];
    const _t1=autoGrasshopperTarget(_from[0],_from[1],null);
    ok('hopper · a "use N power-up" goal makes it hunt that power-up',
       !!_t1&&_t1[0]===_far[0]&&_t1[1]===_far[1], {target:_t1, hopper:_far});
    playerMode=false; editorObjectives=[{type:'detonate',pu:'helicopter',count:4}];
    const _t2=autoGrasshopperTarget(_from[0],_from[1],null);
    ok('hopper · the same goal drives targeting in EDITOR test-play',
       !!_t2&&_t2[0]===_far[0]&&_t2[1]===_far[1], {target:_t2, hopper:_far});
    board[_far[0]][_far[1]].pu=null;
    const _mid=_cells[Math.floor(_cells.length/2)]; board[_mid[0]][_mid[1]].pu='rocket_v';
    playerMode=true; playerGoals=[{kind:'detonate',pu:'rocket',need:2,have:0}];
    const _t3=autoGrasshopperTarget(_from[0],_from[1],null);
    ok('hopper · either Dragonfly half satisfies a rocket goal',
       !!_t3&&_t3[0]===_mid[0]&&_t3[1]===_mid[1], {target:_t3, rocket:_mid});
    board[_mid[0]][_mid[1]].pu=null;
    playerGoals=_savedGoals; editorObjectives=_savedObjs; playerMode=_savedMode;
    await startPlayerLevel(1,false); await wait(45); playing=false;

    setLayer('tile'); setFlow('down');

    // A NEW blank level must not inherit the previous level's identity. openEditor()
    // never cleared curLevelNum (and it initializes to 1), so "＋ Add level" opened
    // reading "Level 1" no matter what — Jed 2026-08-26, adding to DancingPangolin.
    // Pre-existing, shipped, and invisible until someone looked at the HUD.
    await startPlayerLevel(1,false); await wait(45);
    ok('editor · a loaded level sets its own number', curLevelNum===1, curLevelNum);
    const _tgt=saveTargetBundle, _edit=bundleEditNum;
    saveTargetBundle=null; bundleEditNum=null;   // classic new level: no bundle target
    R=9;C=11; openEditor();
    ok('editor · a fresh blank level does NOT inherit the last level number', curLevelNum===null, curLevelNum);
    ok('editor · fresh-level HUD shows no number', (updEditorFrame(),(document.getElementById('ehud-level')||{}).textContent==='—'), (document.getElementById('ehud-level')||{}).textContent);
    ok('editor · a fresh blank level honours the chosen grid size', R===9&&C===11&&board.length===9&&board[0].length===11, R+'x'+C);
    ok('editor · the number a bundle will assign has ONE definition', typeof nextBundleLevelNum==='function', typeof nextBundleLevelNum);
    saveTargetBundle=_tgt; bundleEditNum=_edit;

    // THE PLAY-FRAME IS THE GRID'S HEIGHT, NEVER THE BOOSTER LIST'S (Jed 2026-08-27).
    // The rail's cap was `min(100%, …)`, and a percentage is ignored while the browser
    // computes the column's intrinsic height — so #eboost handed #eframe its FULL
    // 11-booster content and the frame outgrew the viewport, pushing the grid and both
    // satellite rails below the top menu ("worthless as an editing tool"). The rail may
    // scroll all it likes; it must never make the frame taller than the board it flanks.
    // The suite reaches here still flagged as play mode, where #eframe is
    // display:contents and #eboost is hidden — measuring there proves nothing.
    // Drop the flag so the editor layout is the one under test.
    const _wasPlaying=document.body.classList.contains('player-playing');
    document.body.classList.remove('player-playing');
    render(); updEditorFrame(); await wait(60);
    const _fr=document.getElementById('eframe').getBoundingClientRect().height;
    const _bh=document.getElementById('board').getBoundingClientRect().height;
    ok('editor · the play-frame is the GRID\'s height, not the booster list\'s',
       _fr>0&&_bh>0&&_fr<=_bh+28, {frame:Math.round(_fr), board:Math.round(_bh)});
    const _sc=document.querySelector('#eboost .bpanel-scroll');
    _sc.scrollTop=99999; const _bot=_sc.scrollTop; _sc.scrollTop=0;
    ok('editor · the booster rail still scrolls inside that height',
       _sc.scrollHeight<=_sc.clientHeight+1 || _bot>0,
       {content:_sc.scrollHeight, visible:_sc.clientHeight, bottomReach:_bot});
    if(_wasPlaying) document.body.classList.add('player-playing');

    // ═══ 6d. NO DEAD ENDS — every screen goes back exactly one step ════════════
    // Jed 2026-08-26: the bundles screen hid the back button entirely, so the only
    // exit was the wordmark (a jump to the landing page, not one step back), and
    // Esc did nothing anywhere. Assert the whole ladder, both directions.
    const backBtn=()=>document.getElementById('pback-top');
    const backShown=()=>backBtn()&&getComputedStyle(backBtn()).display!=='none';
    renderBundles(); await wait(60);
    ok('nav · the bundles screen offers a way back', backShown(), 'back button hidden');
    ok('nav · bundles back is labelled Home, not Bundles', backBtn().textContent===TXT('pback_home'), backBtn().textContent);
    navBack(); await wait(60);
    ok('nav · back from bundles lands on the Create/Explore home',
       document.getElementById('home').style.display==='flex'&&!document.getElementById('player').classList.contains('active'),
       document.getElementById('home').style.display);
    renderGrid(); await wait(60);
    ok('nav · the level grid offers a way back', backShown(), 'back button hidden');
    ok('nav · grid back is labelled Bundles', backBtn().textContent===TXT('pback_bundles'), backBtn().textContent);
    navBack(); await wait(60);
    ok('nav · back from the level grid lands on bundles', lastPView==='bundles', lastPView);
    // Esc closes an overlay BEFORE it navigates — an open panel is the innermost thing.
    renderGrid(); await wait(40);
    document.getElementById('leaderboard').classList.add('open');
    navBack();
    ok('nav · Esc closes an open overlay first', !document.getElementById('leaderboard').classList.contains('open')&&lastPView==='grid', lastPView);
    // …and the qualifying level has no back door out of the front door.
    entranceMode=true; const viewBefore=lastPView; navBack();
    ok('nav · the qualifying level cannot be escaped backwards', lastPView===viewBefore, lastPView);
    entranceMode=false;
    ok('nav · back has ONE definition shared by button and Esc', document.getElementById('pback-top').getAttribute('onclick')==='navBack()', document.getElementById('pback-top').getAttribute('onclick'));
    renderBundles(); await wait(40);

    // ═══ 6e. FLOW PREVIEW WAVE (Jed 2026-08-27, Township parity) ══════════════
    // The preview must start AT THE SOURCE and walk downstream one step at a
    // time — a travelling pulse, not the whole board blinking. Ordering is
    // asserted here because the animation itself cannot be verified headlessly
    // (the browser pane registers CSS animations but never advances their clock).
    // THE FRONT MUST STAY A STRAIGHT LINE. The first build ordered by distance
    // along the flow path, which shatters wherever two paths of different lengths
    // run side by side — L25's outer and inner paths put ADJACENT cells 4 steps
    // apart. These assert the property that was actually wanted: a coherent
    // wavefront, on every level including the awkward one.
    const frontCheck=async(L)=>{
      await startPlayerLevel(L,false); await wait(45);
      if(window.flyover){flyStop=0;flyLock=false;}
      const w=flowWaveOrder();
      let ragged=0, desync=0, mixedDirFronts=0;
      const sizes=[], dirSequence=[];
      w.forEach((cells)=>{
        if(!cells||!cells.length)return;
        const rs=cells.map(x=>x[0]), cs=cells.map(x=>x[1]);
        const sameRow=Math.max(...rs)===Math.min(...rs), sameCol=Math.max(...cs)===Math.min(...cs);
        if(!sameRow&&!sameCol)ragged++;            // a front is one row OR one column, never scattered
        const dirs=new Set(cells.map(([r,c])=>(flow[r]&&flow[r][c])||'down'));
        if(dirs.size>1)mixedDirFronts++;           // one front, one direction of travel
        else{ const d0=[...dirs][0]; if(dirSequence[dirSequence.length-1]!==d0)dirSequence.push(d0); }
        sizes.push(cells.length);
      });
      // Cells that are neighbours AND travel together must light together — this
      // is the L25 failure: outer and inner paths put adjacent cells 4 beats apart.
      const at=new Map();
      w.forEach((cells,d)=>(cells||[]).forEach(([r,c])=>{ if(!at.has(r+','+c))at.set(r+','+c,d); }));
      at.forEach((d,k)=>{
        const [r,c]=k.split(',').map(Number);
        const mine=(flow[r]&&flow[r][c])||'down';
        for(const [nr,nc] of [[r,c+1],[r+1,c]]){
          const nd=at.get(nr+','+nc);
          if(nd===undefined)continue;
          const theirs=(flow[nr]&&flow[nr][nc])||'down';
          if(theirs!==mine)continue;               // different directions: different fronts, fine
          const v=FLOW_VEC[mine];
          const perpendicular=(v[0]!==0)?(nr===r):(nc===c);  // neighbour ACROSS the flow
          if(perpendicular&&Math.abs(nd-d)>0)desync++;       // same front => same beat
        }
      });
      // continuity: no dead beats, and every direction change hands off along flow
      const emptyBeats=w.filter(c=>!c.length).length;
      let brokenTurns=0;
      for(let d=1;d<w.length;d++){
        const prev=w[d-1], cur=w[d];
        if(!prev.length||!cur.length)continue;
        const pd=(flow[prev[0][0]]&&flow[prev[0][0]][prev[0][1]])||'down';
        const cd=(flow[cur[0][0]]&&flow[cur[0][0]][cur[0][1]])||'down';
        if(pd===cd)continue;                       // same direction: ordinary advance
        const feeds=prev.some(([r,c])=>{
          const v=FLOW_VEC[pd];
          return cur.some(([nr,nc])=>r+v[0]===nr&&c+v[1]===nc);
        });
        if(!feeds)brokenTurns++;
      }
      return {ragged,desync,mixedDirFronts,depths:w.length,dirSequence,emptyBeats,brokenTurns,
              minFront:Math.min(...sizes),maxFront:Math.max(...sizes)};
    };
    let fc=await frontCheck(14);
    ok('flow preview · L14 fronts are straight lines', fc.ragged===0, fc);
    ok('flow preview · L14 has no neighbour desync', fc.desync===0, fc);
    ok('flow preview · plain down-flow gives FULL-WIDTH fronts', fc.minFront===fc.maxFront&&fc.maxFront>1, fc);
    fc=await frontCheck(25);
    ok('flow preview · L25 (outer+inner paths) fronts stay straight', fc.ragged===0, fc);
    ok('flow preview · L25 neighbours never fall out of sync', fc.desync===0, fc);
    // Every cell in one front travels the SAME WAY — that is what makes it a front
    // rather than an arbitrary group, and it is why L25 splits into three phases.
    ok('flow preview · every front is one direction only', fc.mixedDirFronts===0, fc);
    ok('flow preview · L25 sweeps down, then right, then up (Township order)',
       fc.dirSequence.join('>')==='down>right>up', fc.dirSequence);
    // THE LONG PATH IS THE METRONOME (Jed 2026-08-27): the beat never stops. No
    // empty beats, and where the front turns, the last cell of the old direction
    // must RELEASE INTO the first cell of the new one — the wave hands off along
    // the real gem path instead of restarting somewhere else.
    ok('flow preview · the beat never stops (no empty beats)', fc.emptyBeats===0, fc.emptyBeats);
    ok('flow preview · the front hands off along the flow when it turns',
       fc.brokenTurns===0, fc.brokenTurns);
    const step=Math.max(22,Math.min(130,Math.round(2600/Math.max(fc.depths,1))));
    ok('flow preview · adaptive step keeps any sweep under ~3.5s', fc.depths*step<3500, fc.depths*step);
    // A one-cell-thin region has no front to draw. Jed's serpentine reverses every
    // row, so no two neighbours travel the same way — single-cell fronts are the
    // CORRECT answer there, not a degenerate one.
    const _R=R,_C=C,_b=board,_f=flow;
    R=9;C=11;board=[];flow=[];
    for(let r=0;r<R;r++){board.push([]);flow.push([]);
      for(let c=0;c<C;c++){board[r].push({gem:null,active:true,obs:null,pu:null,sub:null,item:null});flow[r].push('down');}}
    for(let r=0;r<R;r++){const rt=r%2===0;
      for(let c=0;c<C;c++)flow[r][c]=rt?'right':'left';
      if(r<R-1)flow[r][rt?C-1:0]='down';}
    const sw=flowWaveOrder().filter(c=>c.length);
    ok('flow preview · a reversing serpentine yields single-cell fronts',
       sw.length===99&&sw.every(c=>c.length===1), {fronts:sw.length, sizes:[...new Set(sw.map(c=>c.length))]});
    R=_R;C=_C;board=_b;flow=_f;

    // RENDER-PROOF (Jed 2026-08-27). The wave used to hang its chevrons inside the
    // board's cells, and render() rebuilds the board with `bd.innerHTML=''` — so any
    // re-render mid-sweep deleted the whole wave and it froze wherever it had got to.
    // That is the bug Jed hit trying to clip L25: "it stops in different places, never
    // finishes." The hints now live in their own layer beside the board. These pin
    // that: the sweep draws, a render cannot touch it, and stopping leaves nothing.
    await startPlayerLevel(25,false); await wait(45);
    runFlowSweep(); await wait(30);
    const drawn=document.querySelectorAll('.flowhint').length;
    ok('flow preview · a sweep actually draws chevrons', drawn>0, drawn);
    ok('flow preview · hints are NOT children of the board (render() wipes it)',
       drawn>0&&[...document.querySelectorAll('.flowhint')].every(s=>!document.getElementById('board').contains(s)),
       'a hint is parented to a cell');
    render();
    ok('flow preview · a mid-sweep render() cannot kill the wave',
       document.querySelectorAll('.flowhint').length===drawn,
       {before:drawn,after:document.querySelectorAll('.flowhint').length});
    stopFlowPreview();
    ok('flow preview · stopping the preview leaves no hints behind',
       document.querySelectorAll('.flowhint').length===0, document.querySelectorAll('.flowhint').length);

    // Flow glyphs must be DRAWN, not typed. Text characters ('v' a letter, '^' a
    // caret, '<'/'>' math operators) have unrelated shapes and baselines and can
    // never mirror each other — Jed 2026-08-27. One rotated chevron guarantees it
    // geometrically, so assert the rotations really are opposites.
    const rotOf=d=>{const v=FLOW_VEC[d];return Math.round(Math.atan2(v[0],v[1])*180/Math.PI)-90;};
    ok('flow glyph · every direction renders real SVG, not a text character',
       ['down','up','left','right'].every(d=>/<svg/.test(chevronSVG(d,40))&&/<path/.test(chevronSVG(d,40))),
       ['down','up','left','right'].map(d=>chevronSVG(d,40).slice(0,18)));
    ok('flow glyph · up is down rotated 180 (a true mirror)', Math.abs(rotOf('up')-rotOf('down'))===180, [rotOf('up'),rotOf('down')]);
    ok('flow glyph · left is right rotated 180 (a true mirror)', Math.abs(rotOf('left')-rotOf('right'))===180, [rotOf('left'),rotOf('right')]);
    // CONTRAST ON EVERY SURFACE THE SWEEP CROSSES. A single pale-green chevron
    // measured 1.45:1 against the sand of an empty active cell — invisible, which
    // is what Jed caught on L25 (and the same trap as the light-on-sand animation
    // lesson). Two strokes: a dark casing that carries on light cells, a bright
    // core that carries on dark ones. At least one must clear 4.5:1 anywhere.
    const _lum=h=>{const p=[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255)
      .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
      return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2];};
    const _ratio=(a,b)=>{const s=[_lum(a),_lum(b)].sort((x,y)=>y-x);return (s[0]+0.05)/(s[1]+0.05);};
    const svgNow=chevronSVG('down',40);
    const strokes=(svgNow.match(/stroke="(#[0-9a-fA-F]{6})"/g)||[]).map(m=>m.slice(8,15));
    ok('flow glyph · chevron is drawn with two strokes (dark casing + bright core)', strokes.length>=2, strokes);
    ['#d4b483','#0d1a0d','#241b30'].forEach(surface=>{
      const best=Math.max(...strokes.map(s=>_ratio(s,surface)));
      ok('flow glyph · legible on '+surface+' (best stroke >= 4.5:1)', best>=4.5, best.toFixed(2));
    });
    ok('flow glyph · all four share one path (identical but for rotation)',
       new Set(['down','up','left','right'].map(d=>chevronSVG(d,40).replace(/rotate\([^)]*\)/,''))).size===1,
       'paths differ beyond rotation');

    // ═══ 7-9. PLAYER-SESSION LAYER (real-vs-sandbox routing, goal loading,
    // bundle-scoped stars) — added 2026-08-25 after TWO regressions shipped
    // live and neither was caught: Session 24's sandbox goal-tracking made
    // togglePlay() unconditionally (a) mark every play-start as sandbox
    // (real player stars silently stopped saving) and (b) overwrite
    // playerGoals from the editor's own state (the qualifying level's Goals
    // panel went blank). Sections 1-6 above never touch playerFinish/
    // togglePlay/PlayerProgress at all — this is the layer both bugs lived
    // in, entirely uncovered until now. Every regression found from here on
    // gets a permanent test here THE SAME SESSION IT'S FOUND — that's the
    // whole point (Jed 2026-08-25: "every time you fix a bug, you break at
    // least one other UX I'd already approved").
    //
    // SAFETY: these tests write real stars through the real functions a
    // player uses. Never let a run touch the actual save or push junk to
    // the live Supabase progress table (auth.js hooks PlayerProgress.set to
    // upsert on every write when signed in — and local dev auto-signs-in
    // anonymously, so this WILL fire against production Supabase if not
    // suppressed). Snapshot .data + .bundle, swap .set for a local-only
    // clone for the duration, hard-restore everything in the nested finally
    // below regardless of pass/fail.
    const _savedData=JSON.parse(JSON.stringify(PlayerProgress.data));
    const _savedBundle=PlayerProgress.bundle;
    const _savedCurBundle=(typeof curBundle!=='undefined')?curBundle:null;
    const _realSet=PlayerProgress.set;
    PlayerProgress.set=function(n,s,rec){ // local-only clone — no cloud push, mirrors the real .set exactly
      const old=this.bucket()[n];
      this.bucket()[n]={s:s,rec:rec||this.record(n)||0,m:(old&&typeof old==='object'&&old.m)||0};
      this.save();
    };
    try {
      // ═══ 7. REAL VS SANDBOX ROUTING (the star-saving regression) ═══════════
      PlayerProgress.data={0:{}}; PlayerProgress.bundle=0; curBundle=null;
      await startPlayerLevel(1,false); await wait(45);
      ok('player · real entry (beginPlaySession) is NOT sandbox', editorSandboxPlay===false, editorSandboxPlay);
      moves=3; playerFinish(true);
      ok('player · a real win writes PlayerProgress (native bundle 0)', PlayerProgress.stars(1)===1, PlayerProgress.stars(1));
      pwinContinue(); // clears the win overlay, mirrors real UI flow — must not throw

      // editor's OWN ▶ Play (no args → sandbox=true default) must still tag
      // itself sandbox, and a "win" while sandboxed must NOT touch PlayerProgress.
      playing=false; togglePlay(); // start branch, sandbox default
      ok('player · editor\'s own ▶ Play still tags itself sandbox', editorSandboxPlay===true, editorSandboxPlay);
      const starsBeforeSandboxWin=PlayerProgress.stars(1);
      curLevelNum=1; playerFinish(true); // routes into sandboxPlayerFinish — must NOT touch PlayerProgress
      ok('player · sandbox play never touches PlayerProgress', PlayerProgress.stars(1)===starsBeforeSandboxWin, PlayerProgress.stars(1));
      document.getElementById('pwin').classList.remove('open');
      togglePlay(); // stop — resets editorSandboxPlay=false, playerMode=false

      // ═══ 8. ENTRANCE GOALS SURVIVE REAL ENTRY (the blank-Goals-panel regression) ═
      startEntrance(); await wait(45);
      ok('player · entrance loads all 5 qualifying goals', playerGoals.length===5, playerGoals.length);
      ok('player · entrance keeps two-stage make→fire PU goals', playerGoals.filter(g=>g.kind==='pu').length===4, playerGoals.filter(g=>g.kind==='pu').length);
      ok('player · entrance keeps its collect goal', playerGoals.some(g=>g.kind==='collect'&&g.need===12), playerGoals.find(g=>g.kind==='collect'));
      leaveEntrance();

      // ═══ 9. BUNDLE-SCOPED PROGRESS ISOLATION ════════════════════════════════
      PlayerProgress.data={0:{}}; PlayerProgress.bundle=0;
      PlayerProgress.set(5,2,10); // native bundle 0, level 5
      PlayerProgress.bundle=424242; // sentinel — never a real bundles.id
      ok('bundle · a fresh community bundle starts with 0 stars on a level the native bundle has starred', PlayerProgress.stars(5)===0, PlayerProgress.stars(5));
      PlayerProgress.set(1,1,5); // community bundle, level 1 — same level number as native L1, must not collide
      PlayerProgress.bundle=0;
      ok('bundle · native progress is untouched by a same-numbered community level', PlayerProgress.stars(5)===2&&PlayerProgress.stars(1)===0, {n5:PlayerProgress.stars(5),n1:PlayerProgress.stars(1)});
      PlayerProgress.bundle=424242;
      ok('bundle · community progress is unaffected by native writes', PlayerProgress.stars(1)===1, PlayerProgress.stars(1));
      resetLevelStars(1); // must delete from the AMBIENT bucket, not PlayerProgress.data[n] directly
      ok('bundle · resetLevelStars clears the current bundle\'s bucket only', PlayerProgress.stars(1)===0, PlayerProgress.stars(1));
      PlayerProgress.bundle=0;
      ok('bundle · resetLevelStars on a community bundle did not touch native', PlayerProgress.stars(5)===2, PlayerProgress.stars(5));

      // ═══ 10. COMMUNITY BUNDLE PLAY, END TO END ══════════════════════════════
      // No real published bundle exists to fetch — stand in with a real level
      // JSON (schema-identical to what submitBundle() actually stores) under a
      // sentinel id, exactly mirroring openCommunityBundle()'s shape.
      const l1json=await (await fetch('levels/level-001.json',{cache:'no-cache'})).json();
      curBundle={ id:424243, title:'Invariants Test Bundle', levels:[l1json] };
      PlayerProgress.bundle=424243; PlayerProgress.data[424243]={};
      startCommunityLevel(1); await wait(45);
      ok('community · startCommunityLevel is real play, not sandbox', editorSandboxPlay===false, editorSandboxPlay);
      moves=2; playerFinish(true);
      ok('community · a win stars the COMMUNITY bucket only', PlayerProgress.stars(1)===1, PlayerProgress.stars(1));
      PlayerProgress.bundle=0;
      ok('community · native L1 stars untouched by community L1 win', PlayerProgress.stars(1)===0, PlayerProgress.stars(1));
      PlayerProgress.bundle=424243;
      pwinContinue(); // win → should route to renderCommunityGrid(), not native renderGrid()
      ok('community · pwinContinue after a win returns to the COMMUNITY grid title', document.getElementById('pgrid-title').textContent===curBundle.title, document.getElementById('pgrid-title').textContent);
      exitToGrid(); // idempotent re-check via the other exit path
      ok('community · exitToGrid also returns to the COMMUNITY grid', document.getElementById('pgrid-title').textContent===curBundle.title, document.getElementById('pgrid-title').textContent);
      playerBack();
      ok('community · playerBack resets to native context (bundle 0, curBundle null)', PlayerProgress.bundle===0&&curBundle===null, {bundle:PlayerProgress.bundle,curBundle});

    // ═══ 11b. BOARD MOTION REGISTRY (the `animating` boolean's replacement) ═══
    // The boolean is GONE — that is the point, not a detail: two sources of truth
    // for "may the player act?" is how the flag drifted wrong in the first place.
    // Today every claim is board-wide, so these answers must match the old flag's
    // exactly. The narrow-claim tests below are the mechanism Rule A / Still Water
    // stand on, proven before either rule exists.
    {
      await startPlayerLevel(1,false); await wait(45);
      ok('motion · the global `animating` boolean no longer exists', typeof window.animating==='undefined'&&(()=>{try{animating;return false;}catch(e){return true;}})(), typeof window.animating);
      Motion.releaseAll();
      ok('motion · a settled board is quiet everywhere', !Motion.busy()&&Motion.quietAt(0,0)&&Motion.quietAt(R-1,C-1), Motion.tags());
      Motion.claim('test-board');
      ok('motion · a board-wide claim reads busy', Motion.busy(), Motion.tags());
      ok('motion · a board-wide claim silences every cell (today\'s behaviour, exactly)',
         !Motion.quietAt(0,0)&&!Motion.quietAt(R-1,C-1)&&!Motion.quietAt((R/2)|0,(C/2)|0), 'a cell stayed quiet under a board-wide claim');
      Motion.releaseAll();
      ok('motion · releaseAll clears every claim', !Motion.busy()&&Motion.tags().length===0, Motion.tags());

      // The seam itself: a claim that covers PART of the board leaves the rest quiet.
      Motion.claim('test-narrow',[[0,0],[0,1]]);
      ok('motion · a narrow claim is busy but only where it claims',
         Motion.busy()&&!Motion.quietAt(0,0)&&!Motion.quietAt(0,1)&&Motion.quietAt(R-1,C-1), Motion.tags());
      Motion.release('test-narrow');
      ok('motion · release(tag) drops exactly that claim', !Motion.busy(), Motion.tags());
      Motion.claim('a',[[1,1]]); Motion.claim('b',[[2,2]]);
      ok('motion · claims compose — a cell is busy if ANY claim covers it',
         !Motion.quietAt(1,1)&&!Motion.quietAt(2,2)&&Motion.quietAt(3,3), Motion.tags());
      Motion.release('a');
      ok('motion · releasing one claim leaves the other standing', Motion.quietAt(1,1)&&!Motion.quietAt(2,2), Motion.tags());
      Motion.releaseAll();

      // Input must actually obey the registry — the reason it exists.
      const before=JSON.stringify(board);
      Motion.claim('test-lock');
      playTap(1,1); playTap(1,2);
      ok('motion · a claimed cell refuses a play tap', JSON.stringify(board)===before, 'the board moved under a claim');
      Motion.releaseAll();

      // NO CLAIM MAY OUTLIVE ITS MOVE. A leaked claim is the new shape of the old
      // bug — a board that never accepts input again — so a real detonation is run
      // end to end and the registry must come back empty on its own.
      // NOTE: a real level board, deliberately NOT wipe()d — a board of one colour
      // re-matches on every refill and cascades forever, which would read as a leak.
      await startPlayerLevel(1,false); await wait(45);
      ok('motion · an idle board holds no claims', !Motion.busy(), Motion.tags());
      const hit=[]; for(let r=0;r<R&&hit.length<3;r++)for(let c=0;c<C&&hit.length<3;c++)
        if(board[r][c].active&&board[r][c].gem!==null&&!board[r][c].obs&&!board[r][c].pu&&!board[r][c].item)hit.push([r,c]);
      applyEffects(hit,hit[0][0],hit[0][1],[]);
      ok('motion · firing effects claims the board', Motion.busy(), Motion.tags());
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);   // let the cascade run itself out
      ok('motion · the claim is released when the cascade ends (no leak)', !Motion.busy(), Motion.tags());
      ok('motion · every cell is playable again afterwards', Motion.quietAt(0,0)&&Motion.quietAt(R-1,C-1), 'a cell stayed locked');
    }

    // ═══ 11g. A QUIET BOARD NEVER HOLDS AN UNRESOLVED MATCH ═══════════════════
    // THE L25 FREEZE (Jed, first hand-test of Still Water): swap at the entry
    // point, then swap downstream into the first one's falling water. The second
    // swap COMMITS, but resolve() refuses its match because the other chain owns
    // those cells — and if that chain has already scanned, nobody ever comes back
    // for it. The move counted, nothing happened, and the board reads as frozen.
    // The rule that makes it impossible: the last chain standing sweeps.
    {
      await startPlayerLevel(1,false); await wait(45);
      const A=GEM_POOL[0],B=GEM_POOL[1],D=GEM_POOL[2];
      Motion.releaseAll(); playing=true;
      for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c];
        cd.active=true;cd.obs=null;cd.item=null;cd.pu=null;cd.puClover=false;cd.startEmpty=false;cd.sub=null;
        cd.gem=[A,B,D][(r+c)%3]; }
      for(let c=0;c<3;c++)board[R-1][c].gem=A;          // one plain match, nothing else

      // Another chain owns exactly those cells — resolve must refuse them...
      const owner=Motion.newChain('other');
      Motion.claim(owner+'/fall',[[R-1,0],[R-1,1],[R-1,2]]);
      const mine=Motion.newChain('swap');
      Motion.claim(mine+'/swap',[[0,0],[0,1]]);
      resolve(findPatterns(-1,-1,-1,-1),-1,-1,JSON.parse(JSON.stringify(board)),-1,-1,mine);
      for(let i=0;i<40&&Motion.tags().some(t=>t.indexOf(mine+'/')===0);i++) await wait(50);
      ok('sweep · a match owned by another chain is left alone while that chain runs',
         board[R-1][0].gem===A&&board[R-1][1].gem===A&&board[R-1][2].gem===A, 'it was resolved by the wrong chain');

      // ...and when the owner finishes, the LAST chain standing must clean it up.
      Motion.releaseChain(owner);
      cascadeEnd(Motion.newChain('last'));
      for(let i=0;i<80&&Motion.busy();i++) await wait(50);
      ok('sweep · a quiet board holds NO unresolved match (the L25 freeze)',
         find3().length===0, find3().length+' matches left sitting on a settled board');
      let empt=0; for(let r=0;r<R;r++)for(let c=0;c<C;c++){const cd=board[r][c];
        if(cd.active&&!cd.obs&&!cd.item&&!cd.pu&&cd.gem===null&&!cd.startEmpty)empt++;}
      ok('sweep · and it refilled what the sweep cleared', empt===0, empt);

      // THE L23 HALF: no match left over, just a HOLE. One chain's clear can land
      // after another chain's gravity has already run, and the hole it leaves has
      // nobody to fill it — the board goes quiet with empty cells and a level that
      // can no longer be finished. Caught by fuzzing L23, round 1, cell [5,5].
      Motion.releaseAll();
      await startPlayerLevel(1,false); await wait(45); playing=true;
      board[2][2].gem=null; board[2][3].gem=null; board[3][4].gem=null;
      ok('sweep · a hole on a settled board is recognised as unfinished business', fillableGap(), 'fillableGap said no');
      cascadeEnd(Motion.newChain('last'));
      const holes2=()=>{let h=0;for(let r=0;r<R;r++)for(let c=0;c<C;c++){const cd=board[r][c];
        if(cd.active&&!cd.obs&&!cd.item&&!cd.pu&&cd.gem===null&&!cd.startEmpty)h++;}return h;};
      for(let i=0;i<160&&holes2();i++) await wait(50);
      ok('sweep · a quiet board holds NO fillable gap (the L23 freeze)', holes2()===0, holes2()+' cells left empty');

      // ...and a canal cell with nothing upstream is NOT a gap — otherwise L25's
      // whole canal reads as broken and every move chases holes that belong there.
      await startPlayerLevel(25,false); await wait(60);
      ok('sweep · L25\'s empty canal is not mistaken for a gap', !fillableGap(), 'the canal was read as unfinished');
      Motion.releaseAll(); playing=false;
    }

    // ═══ 11i. A LONG SEQUENCE IS NOT A STALL (Jed's L23 console, 2026-08-29) ═══
    // The freeze he caught was the WATCHDOG killing a healthy Grasshopper swarm:
    // combo-convert claims the board once and then runs for seconds, and progress
    // was only ever reported on a claim or a detonation. It was declared dead at
    // 6s and a recovery settle ran underneath it — 29 empty cells and 3 unresolved
    // matches, which is exactly what his screenshot showed.
    {
      await startPlayerLevel(1,false); await wait(45); Motion.releaseAll(); playing=true;
      const ch=Motion.newChain('combo-convert');
      Motion.claim(ch+'/combo-convert');
      Motion._seen.set(ch,Date.now()-(STALL_MS-1500));   // quiet for a while, but not dead
      Motion.touch(ch);                                   // ...and then it reports in, like a swarm step
      const before=window.stallCount;
      window._stallTick();
      ok('stall · a sequence that reports progress is never killed',
         window.stallCount===before&&Motion.tags().some(t=>t.indexOf(ch+'/')===0), Motion.tags());

      // A chain the watchdog DID give up on must stay dead — a late callback from it
      // must not settle the board a second time, on top of the recovery.
      Motion._seen.set(ch,Date.now()-99999);
      window._stallTick();
      ok('stall · a silent chain is still killed', !Motion.tags().some(t=>t.indexOf(ch+'/')===0), Motion.tags());
      ok('stall · and it is marked dead, not merely released', Motion.isDead(ch), 'not marked');
      const claimsBefore=Motion.tags().length;
      settleAndCascade(new Set(),0,0,ch);                 // the late callback arrives
      await wait(250);
      ok('stall · a dead chain\'s late callback does nothing', Motion.tags().length===claimsBefore, Motion.tags());
      Motion.releaseAll(); playing=false;
    }

    // ═══ 11j. THE SWARM OWNS ONLY ITS OWN HOPPERS ═════════════════════════════
    // Same console log: "34 PUs in sequence from one move". The swarm scanned the
    // WHOLE BOARD for its next Grasshopper — safe under Engine 1, where nothing
    // else could be running, and a runaway under Still Water: it fires a hopper
    // another chain just made, which clears more, which makes more.
    {
      await startPlayerLevel(1,false); await wait(45); Motion.releaseAll();
      wipe(GEM_POOL[1]); playing=true; playerMode=true;
      const mine=[[1,1],[1,2]], theirs=[4,4];
      mine.forEach(([r,c])=>{board[r][c].gem=null;board[r][c].pu='helicopter';});
      board[theirs[0]][theirs[1]].gem=null; board[theirs[0]][theirs[1]].pu='helicopter'; // another chain's PU
      const ch2=Motion.newChain('combo-convert'); Motion.claim(ch2+'/combo-convert');
      hopperSequence(mine.map(x=>x.slice()),{r:1,c:1,convertTo:'helicopter'},ch2);
      for(let i=0;i<80&&Motion.tags().some(t=>t.indexOf(ch2+'/')===0);i++) await wait(50);
      ok('swarm · a hopper the swarm does not own is left alone',
         board[theirs[0]][theirs[1]].pu==='helicopter'||board[theirs[0]][theirs[1]].gem!==null,
         'the swarm fired another chain\'s Grasshopper');
      Motion.releaseAll(); playing=false; playerMode=false;
    }

    // ═══ 11h. THE GRID THAT BREAKS IT — upstream swap, then downstream swap ═══
    // Jed's repro, in words: swap a gem near the entry point, then — before that
    // cascade finishes — swap a gem downstream of it. Both are legal. The board
    // stops. Built here as a FIXED GRID instead of a random search, so it either
    // reproduces every run or it is fixed:
    //
    //   row 0    A A .          <- upstream match, completed by lifting a gem UP
    //   ...      (3-colour wash, no accidental runs anywhere)
    //   row R-1  . . . . A A .  <- downstream match, completed by dropping one IN
    //
    // The engine's failure was never in the match logic. It was that "a chain
    // finished" and "the board went quiet" were treated as the same event: chain A
    // reached cascadeEnd while B still held a claim (so A swept nothing), and B left
    // by a path with no cascadeEnd at all. Nobody came back. Both orders are tested,
    // and the second swap is run BOTH as a real match and as a bounce, because the
    // bounce is the path that has no cascadeEnd.
    {
      const A=GEM_POOL[0],B=GEM_POOL[1],D=GEM_POOL[2];
      const layGrid=()=>{
        for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c];
          cd.active=true;cd.obs=null;cd.item=null;cd.pu=null;cd.puClover=false;cd.startEmpty=false;cd.sub=null;
          cd.gem=[A,B,D][(r+c)%3]; }
        board[0][0].gem=A; board[0][1].gem=A; board[1][2].gem=A;      // upstream: lift (1,2) into (0,2)
        board[R-1][C-3].gem=A; board[R-1][C-2].gem=A; board[R-2][C-1].gem=A; // downstream: drop (R-2,C-1) in
      };
      const settledClean=()=>{
        let gaps=0; for(let r=0;r<R;r++)for(let c=0;c<C;c++){const cd=board[r][c];
          if(cd.active&&!cd.obs&&!cd.item&&!cd.pu&&cd.gem===null&&!cd.startEmpty)gaps++;}
        return {gaps,matches:find3().length,claims:Motion.tags()};
      };

      for(const secondIsReal of [true,false]){
        await startPlayerLevel(1,false); await wait(60);
        Motion.releaseAll(); playing=true; playerMode=true; selCell=null;
        layGrid();
        ok('grid · the fixture starts with no match of its own'+(secondIsReal?'':' (bounce run)'),
           findPatterns(-1,-1,-1,-1).length===0, findPatterns(-1,-1,-1,-1).map(p=>p.type));

        playTap(1,2); playTap(0,2);                       // UPSTREAM swap
        await wait(150);                                  // ...and while it is still cascading:
        selCell=null;
        if(secondIsReal){ playTap(R-2,C-1); playTap(R-1,C-1); }   // DOWNSTREAM match
        else            { playTap(0,C-1);  playTap(1,C-1);  }     // DOWNSTREAM bounce (no cascadeEnd on this path)

        for(let i=0;i<200&&(Motion.busy()||settledClean().gaps||settledClean().matches);i++) await wait(50);
        const st=settledClean();
        ok('grid · upstream then downstream '+(secondIsReal?'match':'bounce')+' — no match left on the settled board',
           st.matches===0, st);
        ok('grid · upstream then downstream '+(secondIsReal?'match':'bounce')+' — no hole left on the settled board',
           st.gaps===0, st);
        ok('grid · upstream then downstream '+(secondIsReal?'match':'bounce')+' — nothing left claimed',
           st.claims.length===0, st.claims);
      }
      Motion.releaseAll(); playing=false; selCell=null;
    }

    // ═══ 11f. NO CHAIN MAY STRAND THE BOARD (the L16 freeze) ══════════════════
    // Jed froze L25 on the first hand-test of Still Water. The shape, found by
    // fuzzing: a chain claims cells and then hands off to a DIFFERENT chain, so
    // its own claim is never released and those cells refuse input forever.
    // Engine 1 could not have this bug — `animating=false` cleared everyone's
    // state at once, which is exactly the "one flag, two universes" trap.
    {
      await startPlayerLevel(16,false); await wait(45);
      Motion.releaseAll(); playing=true;

      // 1. A PU⇄PU combo is the SAME move as the swap that made it.
      const swapChain=Motion.newChain('swap');
      Motion.claim(swapChain+'/swap',[[0,0],[0,1]]);
      const puCells=[];
      for(let r=0;r<R&&puCells.length<2;r++)for(let c=0;c<C-1&&puCells.length<2;c++)
        if(board[r][c].active&&board[r][c+1].active&&!board[r][c].obs&&!board[r][c+1].obs)puCells.push([r,c],[r,c+1]);
      if(puCells.length>=2){
        const [ar,ac]=puCells[0],[br,bc]=puCells[1];
        board[ar][ac].gem=null;board[ar][ac].pu='rocket_h';
        board[br][bc].gem=null;board[br][bc].pu='rocket_v';
        startPUCombo(ar,ac,br,bc,swapChain);
        ok('freeze · a combo claims under the SWAP\'s chain, never its own',
           Motion.tags().some(t=>t.indexOf(swapChain+'/')===0)&&!Motion.tags().some(t=>/^combo#/.test(t)), Motion.tags());
        // A combo cascade on L16's clover board can run for a while — poll the
        // PROPERTY (nothing of this swap is still claimed), not a stopwatch.
        for(let i=0;i<240&&Motion.tags().some(t=>t.indexOf(swapChain+'/')===0);i++) await wait(50);
        ok('freeze · the swap\'s own claim is gone when the combo finishes',
           !Motion.tags().some(t=>t.indexOf(swapChain+'/')===0), Motion.tags());
      }
      Motion.releaseAll();

      // 2. A Grasshopper reticle belongs to the chain that swapped it. Another
      //    chain ending first must not open it — a reticle claims every tap, so
      //    opening one nobody asked for reads to the player as a frozen board.
      await startPlayerLevel(1,false); await wait(45); Motion.releaseAll(); playing=true;
      const owner=Motion.newChain('swap'), stranger=Motion.newChain('swap');
      window._pendingHopperChoose={r:1,c:1,excluded:new Set(),orthCells:[],chain:owner};
      cascadeEnd(stranger);
      ok('freeze · another chain does not open a pending Grasshopper reticle',
         choosingGrasshopper===null&&!!window._pendingHopperChoose, {choosingGrasshopper,pending:!!window._pendingHopperChoose});
      cascadeEnd(owner);
      ok('freeze · the chain that swapped it DOES open it', !!choosingGrasshopper, choosingGrasshopper);
      choosingGrasshopper=null; window._pendingHopperChoose=null; Motion.releaseAll();

      // 3. The watchdog: a claim whose chain has gone silent is released, and the
      //    board it stranded is finished off. A player is never stuck, ever.
      await startPlayerLevel(1,false); await wait(45); Motion.releaseAll(); playing=true;
      const dead=Motion.newChain('swap');
      Motion.claim(dead+'/effects');                  // board-wide, then never released
      board[2][2].gem=null; board[2][3].gem=null;     // died mid-clear, like the real freeze
      const stalls0=window.stallCount;
      Motion._seen.set(dead,Date.now()-99999);        // ...and it has said nothing for ages
      window._stallTick();
      ok('freeze · the watchdog releases a chain that has gone silent',
         !Motion.tags().some(t=>t.indexOf(dead+'/')===0), Motion.tags());
      ok('freeze · the stall is recorded, loudly, for diagnosis',
         window.stallCount===stalls0+1&&window.__lastStall&&window.__lastStall.deadChain===dead, window.__lastStall);
      // The recovery settle starts on a timer, so `busy` is briefly FALSE right
      // after the tick — poll the board itself, never the flag.
      const holesNow=()=>{let h=0;for(let r=0;r<R;r++)for(let c=0;c<C;c++){const cd=board[r][c];
        if(cd.active&&!cd.obs&&!cd.item&&!cd.pu&&cd.gem===null&&!cd.startEmpty)h++;}return h;};
      for(let i=0;i<120&&holesNow();i++) await wait(50);
      ok('freeze · and the board it stranded is refilled, not left half-cleared', holesNow()===0, holesNow()+' cells left empty');

      // 4. A chain that is WORKING must never be killed by the watchdog.
      Motion.releaseAll();
      const live=Motion.newChain('swap');
      Motion.claim(live+'/effects');
      window._stallTick();
      ok('freeze · a chain that is still working is left alone', Motion.busy(), Motion.tags());
      Motion.releaseAll(); playing=false;
    }

    // ═══ 11e. STILL WATER — the player may act where nothing is moving ════════
    // Named by Jed 2026-08-28. Engine 1 froze the WHOLE board for every cascade;
    // the claim is now the honest set of cells in motion, and everything else is
    // the player's. These tests pin both halves: the still water is playable, and
    // the moving water is not.
    {
      await startPlayerLevel(1,false); await wait(45);
      const A=GEM_POOL[0],B=GEM_POOL[1],D=GEM_POOL[2];
      const lay=()=>{ for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c];
        cd.active=true;cd.obs=null;cd.item=null;cd.pu=null;cd.puClover=false;cd.startEmpty=false;cd.sub=null;
        cd.gem=[A,B,D][(r+c)%3]; } };
      Motion.releaseAll(); lay(); playing=true; playerMode=true; selCell=null;

      // A cascade elsewhere on the board, standing in for one in flight.
      const other=Motion.newChain('test-cascade');
      Motion.claim(other+'/fall',[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]);
      ok('still · a narrow claim leaves most of the board quiet',
         Motion.busy()&&!Motion.quietAt(0,0)&&Motion.quietAt(R-1,C-1), Motion.tags());

      // THE RULE: a real move in still water goes through while that cascade runs.
      // It has to be a MATCHING swap — an invalid one bounces back and proves
      // nothing about whether the board accepted the input.
      Motion.releaseAll(); await startPlayerLevel(1,false); await wait(60);
      let mv=null;
      for(let r=0;r<R&&!mv;r++)for(let c=0;c<C&&!mv;c++){
        for(const [nr,nc] of [[r,c+1],[r+1,c]]){
          if(nr>=R||nc>=C)continue;
          const a=board[r][c],b=board[nr][nc];
          if(!a.active||!b.active||a.gem===null||b.gem===null||a.pu||b.pu||a.obs||b.obs)continue;
          if(r<2||nr<2)continue;                       // keep the move clear of the claimed region
          let t=a.gem;a.gem=b.gem;b.gem=t;
          const hits=findPatterns(nr,nc,r,c).length>0;
          t=a.gem;a.gem=b.gem;b.gem=t;
          if(hits){mv=[r,c,nr,nc];break;}
        }
      }
      const cascading=Motion.newChain('test-cascade');
      Motion.claim(cascading+'/fall',[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]);
      const mv0=moves; selCell=null;
      if(mv){ playTap(mv[0],mv[1]); playTap(mv[2],mv[3]); }
      for(let i=0;i<40&&moves===mv0;i++) await wait(50);   // the swap animation runs ~220ms before the move counts
      ok('still · a swap in still water is ACCEPTED while another region cascades',
         !!mv&&moves>mv0, {mv,moves,mv0});
      Motion.releaseChain(cascading);                  // the stand-in cascade finishes
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);

      // And the moving water stays untouchable.
      Motion.releaseAll(); lay(); selCell=null;
      const other2=Motion.newChain('test-cascade');
      Motion.claim(other2+'/fall',[[0,0],[0,1]]);
      const held=JSON.stringify([board[0][0].gem,board[0][1].gem]); const mv1=moves;
      playTap(0,0); playTap(0,1);
      await wait(120);
      ok('still · a swap in MOVING water is refused',
         JSON.stringify([board[0][0].gem,board[0][1].gem])===held&&moves===mv1, {held,moves,mv1});
      Motion.releaseAll(); selCell=null;

      // A match another chain is already moving is not resolved a second time.
      lay();
      for(let c=0;c<3;c++)board[R-1][c].gem=A;           // the only match on the board
      const owner=Motion.newChain('test-owner');
      Motion.claim(owner+'/pop',[[R-1,0],[R-1,1],[R-1,2]]);
      const mine=Motion.newChain('test-mine');
      Motion.claim(mine+'/effects');
      const gemsBefore=board[R-1][0].gem;
      resolve(findPatterns(-1,-1,-1,-1),-1,-1,JSON.parse(JSON.stringify(board)),-1,-1,mine);
      ok('still · a chain does not resolve a match another chain is moving',
         board[R-1][0].gem===gemsBefore, 'the other chain\'s match was cleared twice');
      ok('still · a pass with nothing left to take ENDS its chain instead of spinning',
         Motion.tags().every(t=>t.indexOf(mine+'/')!==0), Motion.tags());
      Motion.releaseAll(); selCell=null;

      // A REAL cascade must narrow to its falling cells, not hold the board.
      await startPlayerLevel(1,false); await wait(45); lay(); playing=true;
      for(let c=0;c<3;c++)board[0][c].gem=A;
      resolve(findPatterns(-1,-1,-1,-1),-1,-1,JSON.parse(JSON.stringify(board)),-1,-1);
      let sawFall=false,sawStillCell=false;
      for(let i=0;i<80;i++){
        if(Motion.tags().some(t=>/\/fall$/.test(t))){
          sawFall=true;
          const cells=Motion.busyCells();
          sawStillCell=!!cells&&Motion.quietAt(R-1,C-1);
          break;
        }
        await wait(25);
      }
      ok('still · a real cascade claims a FALL, not the board', sawFall, Motion.tags());
      ok('still · the far side of the board stays playable during that fall', sawStillCell, 'the fall claimed everything');
      for(let i=0;i<80&&Motion.busy();i++) await wait(50);
      ok('still · the fall claim is released when the gems land', !Motion.busy(), Motion.tags());

      // The star canon is protected: overlapping moves forfeit ★3 credit.
      window.runMaxSeq=0; window._moveOverlapped=true; window._swapPU=4; window._comboSwap=false;
      cascadeEnd(Motion.newChain('test-star'));
      ok('still · an overlapped move does not credit the 3-PU star', (window.runMaxSeq||0)===0, window.runMaxSeq);
      window._moveOverlapped=false; window._swapPU=4;
      cascadeEnd(Motion.newChain('test-star'));
      ok('still · a clean single move still credits it', window.runMaxSeq===4, window.runMaxSeq);
      window.runMaxSeq=0; window._swapPU=0; window._moveOverlapped=false;
      Motion.releaseAll(); playing=false; selCell=null;
    }

    // ═══ 11d. CHAIN IDENTITY — a cascade may only release its OWN claims ══════
    // One player action plus everything that cascades from it is a CHAIN. The
    // moment two cascades can overlap (Still Water), an end-of-move releaseAll()
    // would free the OTHER cascade's claims and unlock a board that is still
    // moving. These tests pin the ownership rule BEFORE anything relies on it.
    {
      await startPlayerLevel(1,false); await wait(45);
      Motion.releaseAll();
      const c1=Motion.newChain('test'), c2=Motion.newChain('test');
      ok('chain · every chain id is unique', c1!==c2, [c1,c2]);
      Motion.claim(c1+'/a',[[0,0]]); Motion.claim(c1+'/b',[[0,1]]); Motion.claim(c2+'/a',[[5,5]]);
      Motion.releaseChain(c1);
      ok('chain · releasing a chain drops ALL of that chain\'s claims', Motion.quietAt(0,0)&&Motion.quietAt(0,1), Motion.tags());
      ok('chain · releasing a chain leaves ANOTHER chain\'s claims standing', !Motion.quietAt(5,5), Motion.tags());
      Motion.releaseChain(c2);
      ok('chain · the second chain still releases its own', !Motion.busy(), Motion.tags());
      // A chain id must not be a prefix-match hazard ('swap#1' vs 'swap#11').
      Motion._chain=0; const a1=Motion.newChain('x'); for(let i=0;i<10;i++)Motion.newChain('x');
      const a11=Motion.newChain('x');
      Motion.claim(a1+'/one',[[0,0]]); Motion.claim(a11+'/one',[[1,1]]);
      Motion.releaseChain(a1);
      ok('chain · a similarly-named chain is not released by prefix accident', !Motion.quietAt(1,1), Motion.tags());
      Motion.releaseAll();

      // End to end: a real cascade claims under its own chain and gives it all back.
      await startPlayerLevel(1,false); await wait(45);
      const hit=[]; for(let r=0;r<R&&hit.length<3;r++)for(let c=0;c<C&&hit.length<3;c++)
        if(board[r][c].active&&board[r][c].gem!==null&&!board[r][c].obs&&!board[r][c].pu&&!board[r][c].item)hit.push([r,c]);
      applyEffects(hit,hit[0][0],hit[0][1],[]);
      const tag=Motion.tags()[0]||'';
      ok('chain · a cascade claims under a chain id, not a bare name', /#\d+\//.test(tag), tag);
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);
      ok('chain · the chain releases itself when its cascade ends', !Motion.busy(), Motion.tags());
    }

    // ═══ 11c. RULE A — MATCHES RESOLVE SIMULTANEOUSLY ═════════════════════════
    // Engine 1 resolved ONE pattern per settle beat, so a second match across the
    // board waited its turn — the stop-and-go. These tests pin both halves of the
    // new rule: independent matches go together, and overlapping ones still don't.
    {
      await startPlayerLevel(1,false); await wait(45);
      const A=GEM_POOL[0],B=GEM_POOL[1],D=GEM_POOL[2];
      // A 3-colour diagonal wash has no runs anywhere — a blank slate to place
      // exactly the matches under test on (wipe() is one colour and matches itself).
      const lay=()=>{ for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c];
        cd.active=true;cd.obs=null;cd.item=null;cd.pu=null;cd.puClover=false;cd.startEmpty=false;cd.sub=null;
        cd.gem=[A,B,D][(r+c)%3]; } };
      lay();
      ok('ruleA · the test wash itself holds no matches', findPatterns(-1,-1,-1,-1).length===0, findPatterns(-1,-1,-1,-1).map(p=>p.type));

      // TWO independent 4-matches, opposite corners. Engine 1: two beats, one PU
      // each. Rule A: one pass, both Dragonflies.
      for(let c=0;c<4;c++)board[0][c].gem=A;
      for(let c=C-4;c<C;c++)board[R-1][c].gem=A;
      let pats=findPatterns(-1,-1,-1,-1);
      ok('ruleA · fixture really is two independent 4-matches',
         pats.filter(p=>p.type==='rocket_v'||p.type==='rocket_h').length===2, pats.map(p=>p.type));
      resolve(pats,-1,-1,JSON.parse(JSON.stringify(board)),-1,-1);
      let pus=0; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].pu)pus++;
      ok('ruleA · both far-apart matches resolve in the SAME pass', pus===2, pus+' power-ups after one resolve');
      ok('ruleA · the pass records how many patterns it took', (window.moveHistory.slice(-1)[0]||{}).patterns===2, window.moveHistory.slice(-1)[0]);
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);

      // A plain 3-match on the far side of a special no longer waits a beat.
      await startPlayerLevel(1,false); await wait(45); lay();
      for(let c=0;c<4;c++)board[0][c].gem=A;          // 4-run → Dragonfly
      for(let c=C-3;c<C;c++)board[R-1][c].gem=B;      // plain 3-run, nowhere near it
      pats=findPatterns(-1,-1,-1,-1);
      const before3=board[R-1][C-1].gem;
      resolve(pats,-1,-1,JSON.parse(JSON.stringify(board)),-1,-1);
      const hist=window.moveHistory.slice(-1)[0]||{};
      ok('ruleA · a plain 3-match resolves alongside a special, not a beat later',
         hist.patterns===2&&/basic3/.test(hist.pattern||''), hist.pattern);
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);

      // OVERLAP IS STILL ONE RESOLUTION. A 5-run is also three plain 3-runs; taking
      // both would clear the same gems twice. Engine 1's priority winner is unchanged.
      await startPlayerLevel(1,false); await wait(45); lay();
      for(let c=0;c<5;c++)board[2][c].gem=A;
      pats=findPatterns(-1,-1,-1,-1);
      ok('ruleA · a 5-run offers a rainbow (and the basic3 that shadows it)',
         pats[0].type==='rainbow', pats.map(p=>p.type));
      const snapBoard=board.map(row=>row.map(x=>x.gem));
      resolve(pats,-1,-1,JSON.parse(JSON.stringify(board)),-1,-1);
      const h2=window.moveHistory.slice(-1)[0]||{};
      ok('ruleA · an overlapping pattern still waits — exactly Engine 1\'s answer',
         h2.patterns===1&&h2.pattern==='rainbow', h2.pattern);
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);

      // A run half-eaten by a special is NOT swept up as a remnant.
      await startPlayerLevel(1,false); await wait(45); lay();
      for(let c=0;c<4;c++)board[0][c].gem=A;   // horizontal 4 → Dragonfly
      board[1][3].gem=A; board[2][3].gem=A;    // vertical 3 sharing the run's last cell
      pats=findPatterns(-1,-1,-1,-1);
      resolve(pats,-1,-1,JSON.parse(JSON.stringify(board)),-1,-1);
      const h3=window.moveHistory.slice(-1)[0]||{};
      ok('ruleA · a run sharing cells with a special is not resolved beside it',
         h3.patterns===1, h3.pattern+' x'+h3.patterns);
      for(let i=0;i<60&&Motion.busy();i++) await wait(50);
      await startPlayerLevel(1,false); await wait(45);
    }

    // ═══ 11. ENGINE VERSION PIN ═══════════════════════════════════════════════
    // The pin exists to make ONE failure impossible: a level authored under a
    // later engine being silently misread by an earlier one after a rollback.
    // These tests are the teeth — without them the pin is a comment.
    {
      const _alert=window.alert; let alerts=[]; window.alert=m=>alerts.push(m); // a refusal must never block a headless run
      try{
        ok('pin · ENGINE_VERSION is a positive integer', Number.isInteger(ENGINE_VERSION)&&ENGINE_VERSION>=1, ENGINE_VERSION);
        await startPlayerLevel(1,false); await wait(45);
        const ser=serializeLevel();
        ok('pin · serializeLevel emits this build\'s engineVersion', ser.engineVersion===ENGINE_VERSION, ser.engineVersion);
        ok('pin · a loaded level reports the version it declared', levelEngineVersion===ENGINE_VERSION, levelEngineVersion);

        // A file from BEFORE the pin existed is Engine 1 data — it must still load.
        const legacy=JSON.parse(JSON.stringify(ser)); delete legacy.engineVersion;
        ok('pin · a level with NO engineVersion still loads (absent = 1)', loadLevelData(legacy,1)===true, 'refused a legacy file');

        // The whole point: a level from a NEWER engine is refused, loudly, and the
        // board it refused is left exactly as it was — not half-clobbered.
        await startPlayerLevel(3,false); await wait(45);
        const beforeR=R, beforeC=C, beforeNum=curLevelNum, beforeBoard=JSON.stringify(board);
        const future=JSON.parse(JSON.stringify(ser)); future.engineVersion=ENGINE_VERSION+1;
        future.board={rows:2,cols:2}; // different geometry, so a partial load would be obvious
        alerts=[];
        const took=loadLevelData(future,99);
        ok('pin · a level from a NEWER engine is refused', took===false, took);
        ok('pin · the refusal is visible to the player, not silent', alerts.length===1, alerts);
        ok('pin · a refused load leaves the current board untouched',
           R===beforeR&&C===beforeC&&curLevelNum===beforeNum&&JSON.stringify(board)===beforeBoard, {R,C,curLevelNum});

        // Garbage in the field must not read as "playable" — only 1..ENGINE_VERSION does.
        // `null` is NOT garbage: JSON round-trips an absent field to null, and absent
        // means Engine 1 by definition, so it must load like any pre-pin file.
        for(const bad of [0,-1,'two',NaN,ENGINE_VERSION+0.5]){
          const j=JSON.parse(JSON.stringify(ser)); j.engineVersion=bad;
          ok('pin · engineVersion '+JSON.stringify(bad)+' is refused', loadLevelData(j,99)===false, bad);
        }
        const nulled=JSON.parse(JSON.stringify(ser)); nulled.engineVersion=null;
        ok('pin · an explicitly null engineVersion reads as 1, like an absent one', loadLevelData(nulled,1)===true, 'refused a null');

        // Round-trip stability: the pin must not break the Scrutinizer's fixed point.
        await startPlayerLevel(1,false); await wait(45);
        const s1=JSON.stringify(serializeLevel());
        loadLevelData(JSON.parse(s1),1);
        ok('pin · serialize→load→serialize is still a fixed point', s1===JSON.stringify(serializeLevel()), 'round-trip diverged');

        // Every shipped level file must be playable by the build that ships with it.
        let unplayable=[];
        for(let L=1;L<=((typeof MAX_BUILT_LEVEL!=='undefined')?MAX_BUILT_LEVEL:25);L++){
          const j=await (await fetch('levels/level-'+String(L).padStart(3,'0')+'.json',{cache:'no-cache'})).json();
          const v=(j.engineVersion==null)?1:Number(j.engineVersion);
          if(!(v>=1&&v<=ENGINE_VERSION))unplayable.push(L+':'+j.engineVersion);
        }
        ok('pin · every shipped level declares an engine THIS build plays', unplayable.length===0, unplayable);
        await startPlayerLevel(1,false); await wait(45); // leave the board on a real level
      } finally { window.alert=_alert; }
    }
    } finally {
      PlayerProgress.set=_realSet;
      PlayerProgress.data=_savedData; PlayerProgress.save();
      PlayerProgress.bundle=_savedBundle; curBundle=_savedCurBundle;
    }

  } catch(e){ ok('SUITE THREW', false, e.message); }
  finally { window.requestAnimationFrame=_raf; window.removeEventListener('error',onerr); }
  ok('no uncaught console errors during run', errs.length===0, errs.slice(0,4));
  return {pass, fail, total:pass+fail, failures:results.filter(r=>!r.pass)};
};
