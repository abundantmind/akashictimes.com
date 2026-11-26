// ═══ AKASHIC FLOW MASTERY + ERASE STARS (Jed 2026-11-26) ═══════════════════════
// 75/75 on Akashic Flow (Ground Zero chapter 1, bundle 0) is a moment, not just
// another firework. One splash announces everything it opens:
//   • the worldwide leaderboard (the "compete publicly" switch unlocks here)
//   • Akashic Window (Ground Zero chapter 2)
//   • Erase Stars — start Akashic Flow over at Level 1 and keep playing it free, forever.
// MASTERY IS PERMANENT (Jed's call): Erase resets PLAY only. The mastery itself, the
// leaderboard place (the board ranks on best-ever stars, db/018) and Akashic Window
// access all stay. The board shows "Mastered #N" in the order players got there.
//
// Local record: localStorage 'akashicswaps-mastered' = {at, rank}. A signed-in player
// also gets it stamped in the cloud (record_mastery, db/018), so another device learns
// it on sign-in (auth.js syncMastery → noteMastery). Plain classic script: it loads
// before index.html's main script and only touches its globals when called.

const MASTERY_KEY='akashicswaps-mastered';       // {at: ISO time, rank: N | null}
const MASTERY_SEEN_KEY='akashicswaps-mastery-seen'; // '1' once the splash has been shown on this device

// This device's mastery record, or null.
function masteryInfo(){
  try{ return JSON.parse(localStorage.getItem(MASTERY_KEY))||null; }catch(e){ return null; }
}
// Stars held right now on Akashic Flow (bundle 0), whatever bundle is open.
function flowStars(){ return bundleStars(0,NATIVE_LEVELS); }
// Mastered = a mastery record OR a full grid right now (a player who got there before
// this build shipped has the stars but no record yet).
function hasMastered(){ return !!masteryInfo() || flowStars()>=NATIVE_LEVELS*3; }

// Remember mastery on this device. Keeps the EARLIEST time; a rank only ever fills in.
// Called by auth.js when the cloud already knows (another device), and by markMastered().
function noteMastery(at,rank){
  const cur=masteryInfo();
  const keepAt=cur&&cur.at&&(!at||cur.at<at)?cur.at:(at||new Date().toISOString());
  const keepRank=rank||(cur&&cur.rank)||null;
  try{ localStorage.setItem(MASTERY_KEY,JSON.stringify({at:keepAt,rank:keepRank})); }catch(e){}
}
window.noteMastery=noteMastery;   // auth.js is a module; it reaches this through window

// Record mastery now (local at once, cloud when signed in) and fill in the rank.
// Returns the rank, or null (offline / not signed in / older database).
async function markMastered(){
  noteMastery(null,null);
  if(!window.AkashicAuth||!AkashicAuth.recordMastery) return null;
  try{
    const m=await AkashicAuth.recordMastery();
    if(m&&m.mastered_at){ noteMastery(m.mastered_at,m.rank); return m.rank; }
  }catch(e){}
  return null;
}

// ── the splash ──────────────────────────────────────────────────────────────
// Shown once per device: right after the 75th star's celebration, or — for a player
// who was already at 75/75 before this shipped — the next time they open Explore.
function showMasterySplash(){
  try{ localStorage.setItem(MASTERY_SEEN_KEY,'1'); }catch(e){}
  const box=document.getElementById('mastery-body');
  const info=masteryInfo(), rank=info&&info.rank;
  box.innerHTML=
     '<div class="ms-arc">'+celeArcSVG(TXT('ms_head'))+'</div>'
    +'<div class="ms-stars">★ '+(NATIVE_LEVELS*3)+' / '+(NATIVE_LEVELS*3)+'</div>'
    +'<div class="ms-rank" id="ms-rank">'+(rank?escHtml(TXT('ms_rank')(rank)):'')+'</div>'
    // 1. the worldwide leaderboard
    +'<div class="ms-item"><div class="ms-item-h">🌍 '+TXT('ms_board_h')+'</div>'
    +'<div class="ms-item-b">'+TXT('ms_board_b')+'</div>'
    +'<button class="ms-btn go" onclick="masteryJoinBoard()">'+TXT('ms_board_btn')+'</button></div>'
    // 2. Akashic Window
    +'<div class="ms-item"><div class="ms-item-h">🪟 '+TXT('ms_window_h')+'</div>'
    +'<div class="ms-item-b">'+TXT('ms_window_b')+'</div>'
    +'<button class="ms-btn" onclick="masteryGoWindow()">'+TXT('ms_window_btn')+'</button></div>'
    // 3. free forever: Erase Stars
    +'<div class="ms-item"><div class="ms-item-h">♾️ '+TXT('ms_erase_h')+'</div>'
    +'<div class="ms-item-b">'+TXT('ms_erase_b')+'</div>'
    +'<button class="ms-btn quiet" onclick="masteryErase()">'+TXT('erase_btn')+'</button></div>'
    +'<button class="ms-close" onclick="hideMasterySplash()">'+TXT('ms_later')+'</button>';
  document.getElementById('mastery').classList.add('open');
  startFireworks(document.getElementById('mastery-fw'));
  // No rank yet: ask the cloud (signed in), then fill it in where it belongs.
  if(!rank) markMastered().then(r=>{ const el=document.getElementById('ms-rank'); if(r&&el) el.textContent=TXT('ms_rank')(r); });
}
function hideMasterySplash(){
  document.getElementById('mastery').classList.remove('open');
  stopFireworks();
}
// Opt in to the board and show it. Not signed in (local dev) → the Settings switch.
async function masteryJoinBoard(){
  hideMasterySplash();
  if(window.AkashicAuth&&AkashicAuth.user&&AkashicAuth.setStarsPublic){
    const ok=await AkashicAuth.setStarsPublic(true);
    if(ok){ openLeaderboard(); return; }
  }
  openSettings();
}
// Straight to Akashic Window: its own grid if owned, else its preview (buy / try).
async function masteryGoWindow(){
  hideMasterySplash();
  if(document.getElementById('pwin').classList.contains('open')) exitToGrid();
  renderBundles();
  if(!window.AkashicAuth||!AkashicAuth.listPublishedBundles) return;
  const rows=await AkashicAuth.listPublishedBundles();
  communityRows=rows;
  const w=rows.find(r=>r.family_name===NATIVE_FAMILY&&r.family_seq===2);
  if(w) openCommunityBundle(w.id);
}
function masteryErase(){
  if(!eraseFlowStars()) return;   // the player said no — leave the splash up
  hideMasterySplash();
  if(document.getElementById('pwin').classList.contains('open')) exitToGrid();
  else if(document.getElementById('player').classList.contains('active')) renderGrid();
}

// ── ERASE STARS — Akashic Flow only ─────────────────────────────────────────
// Wipes every star + move record on Akashic Flow (bundle 0) on this device AND in the
// cloud, so another device's sign-in can't fold them back in. Other bundles are
// untouched (the old "Reset all stars" wiped every bundle, device only). A mastered
// player keeps mastery, board place and Akashic Window. Returns false if cancelled.
function eraseFlowStars(){
  const mastered=hasMastered();
  if(!confirm(mastered?TXT('erase_confirm_m'):TXT('erase_confirm'))) return false;
  if(mastered) noteMastery(null,null);   // make sure the record exists BEFORE the stars that prove it go
  PlayerProgress.data[0]={};
  PlayerProgress.save();
  if(window.AkashicAuth&&AkashicAuth.eraseStars){
    AkashicAuth.eraseStars(0).then(r=>{ if(r&&!r.ok) flashToast(TXT('erase_cloud_fail')); });
  }
  return true;
}
