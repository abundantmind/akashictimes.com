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
    playerMode=true; animating=false; maybeShuffle();
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
    ok('editor · the paint palette offers no gem-colour swatches',
       document.querySelectorAll('#gpal [data-bid^="gem:"]').length===0,
       document.querySelectorAll('#gpal [data-bid^="gem:"]').length);
    (function(){
      const r0=2,c0=2; board[r0][c0].active=true; board[r0][c0].pu=null; board[r0][c0].obs=null;
      board[r0][c0].item=null; board[r0][c0].startEmpty=false;
      board[r0][c0].gem=0; const a=serializeLevel().layers.contents[r0][c0];
      board[r0][c0].gem=3; const b=serializeLevel().layers.contents[r0][c0];
      ok('editor · a gem cell serializes the same whatever colour is painted', a==='g'&&b==='g', {red:a,other:b});
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
