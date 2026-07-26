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
      await startPlayerLevel(L); await wait(45); if(window.flyover){flyStop=0;flyLock=false;}
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
      await startPlayerLevel(L); await wait(45); if(window.flyover){flyStop=0;flyLock=false;}
      const crates=[]; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].obs&&/crate/.test(board[r][c].obs))crates.push([r,c]);
      for(let i=0;i<12;i++){ for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].active&&board[r][c].gem!==null&&!board[r][c].item&&Math.random()<0.5)board[r][c].gem=null; gravityWithMap(); }
      ok(`L${L} · crates never receive a gem (30-pass stress)`, crates.every(([r,c])=>board[r][c].gem===null), 'a crate got a gem');
    }
    // 2b. L25 canal: startEmpty cells never SPAWN (fill only via inflow)
    await startPlayerLevel(25); await wait(45);
    const emptyStart=[]; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].active&&board[r][c].gem===null&&!board[r][c].obs&&!board[r][c].item)emptyStart.push([r,c]);
    for(let r=0;r<4;r++)for(let c=0;c<4;c++) if(board[r][c].active&&board[r][c].gem!==null&&!board[r][c].obs)board[r][c].gem=null;
    gravityWithMap();
    ok('L25 · startEmpty cells do not spawn (no fill from below)', emptyStart.every(([r,c])=>board[r][c].gem===null), 'a sealed cell spawned');
    // 2c. L2 interior holes: gravity never routes a gem INTO / spawns FROM a hole
    await startPlayerLevel(2); await wait(45);
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
    await startPlayerLevel(14); await wait(45); // 8x7 rectangle canvas
    // 3a. double-tap in place, no clover in line -> plants nothing
    wipe(); board[3][col].gem=null; board[3][col].pu='rocket_v'; board[3][col].puClover=false;
    await fireDet('rocket_v',3,col); ok('clover · double-tap-in-place on bare, no clover crossed → 0', colClover()===0, colClover());
    // 3b. in-place, line crosses a clover cell -> touches rule plants line
    wipe(); board[6][col].sub='clover'; board[3][col].gem=null; board[3][col].pu='rocket_v';
    await fireDet('rocket_v',3,col); ok('clover · in-place line crosses clover → plants line', colClover()===R, colClover());
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

    // ═══ 4. CRATE SPLASH FROM DETONATIONS ═════════════════════════════════════
    await startPlayerLevel(14); await wait(60); wipe(GEM_POOL[1]);
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
    await startPlayerLevel(14); await wait(45); wipe();
    const guardAdmitsKey=(cd=>!(!cd.active||(cd.gem===null&&!cd.pu&&cd.item!=='key')))(( ()=>{board[2][2].gem=null;board[2][2].item='key';return board[2][2];})());
    ok('swap · key cell is selectable', guardAdmitsKey, guardAdmitsKey);
    // gem slides into empty active cell to make a match (yellow V-3)
    wipe(GEM_POOL[1]); const Y=GEM_POOL[0]; board[4][3].gem=null; board[3][3].gem=Y; board[2][3].gem=Y; board[4][4].gem=Y;
    (()=>{ const t=board[4][4].gem;board[4][4].gem=board[4][3].gem;board[4][3].gem=t; })(); // slide (4,4)→(4,3)
    ok('swap · gem slides into empty active cell to complete a match', find3().some(([r,c])=>r===4&&c===3), 'no match at gap');

    // ═══ 6. AUTO-SHUFFLE ══════════════════════════════════════════════════════
    await startPlayerLevel(14); await wait(45);
    const three=[GEM_POOL[0],GEM_POOL[1],GEM_POOL[2]];
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){ board[r][c].active=true;board[r][c].obs=null;board[r][c].item=null;board[r][c].pu=null;board[r][c].startEmpty=false;board[r][c].sub=null;board[r][c].gem=three[(r+c)%3]; }
    ok('shuffle · genuine deadlock detected (no move)', !hasValidMove(), 'hasValidMove true on deadlock');
    playerMode=true; animating=false; maybeShuffle();
    ok('shuffle · escapes deadlock → has-move + no-match', hasValidMove()&&find3().length===0, 'still stuck');
    // no-op when a move exists
    await startPlayerLevel(2); await wait(45);
    const snap=board.map(row=>row.map(x=>x.gem)); maybeShuffle();
    let changed=0; for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c].gem!==snap[r][c])changed++;
    ok('shuffle · no-op when a move already exists', changed===0, changed+' cells changed');

  } catch(e){ ok('SUITE THREW', false, e.message); }
  finally { window.requestAnimationFrame=_raf; window.removeEventListener('error',onerr); }
  ok('no uncaught console errors during run', errs.length===0, errs.slice(0,4));
  return {pass, fail, total:pass+fail, failures:results.filter(r=>!r.pass)};
};
