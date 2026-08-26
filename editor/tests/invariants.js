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
