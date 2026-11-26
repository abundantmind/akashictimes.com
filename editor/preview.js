// ═══ BUNDLE PREVIEW (Jed 2026-11-26) ═══════════════════════════════════════════
// "If another Architect produces a bundle that I approve for purchase, can we show
// them what each level looks like before they purchase? Maybe even 5–10 free moves?"
//
// A level's DESIGN is the product, so the level data never leaves the database for a
// shopper (db/007). Instead:
//   • PICTURES — when an admin approves (publishes) a bundle, this page draws every
//     level to an image and stores it (bundle_previews, db/018). Pictures can't be
//     played, so every shopper may see all of them.
//   • A 10-MOVE TEST of level 1 only (bundle_preview_level, db/018). No sign-in needed.
//     Nothing is saved: no stars, no record, no progress row.
// Plain classic script: loads before index.html's main script and only touches its
// globals when called.

const PREVIEW_MOVES=10;   // free moves in the level-1 test
let previewMode=null;     // {id} while a shopper is test-playing level 1 of an unowned bundle
let previewEnded=null;    // {id, won} — the store sheet reopens with "that was your 10 moves"

// ── PICTURES ────────────────────────────────────────────────────────────────
// Draw one canonical level (akashic-level/1) as a single SVG, using the board's own
// art (gemSVG, puSVG, obsSVG, overlaySVG, zeerSVG). It borrows the live board globals
// to run the real loader, and always puts them back. Gem colours are seeded at play,
// never stored, so the picture seeds its own from the level's gem palette.
// Returns {svg, w, h} or null (not a canonical level).
function levelPictureSVG(json){
  if(!json||!json.layers||!json.board||!(json.board.rows>0)||!(json.board.cols>0)) return null;
  const keep={board,flow,R,C};
  try{
    R=json.board.rows; C=json.board.cols;
    loadCanonicalLayers(json);                                    // board[] + flow[] exactly as play would build them
    let pool=(json.gemTypes||[]).map(g=>GEMMAP[g]).filter(i=>i!=null);
    if(!pool.length) pool=[0,1,2,3,4];
    const S=36, G=3, step=S+G, pad=10, W=pad*2+C*step-G, H=pad*2+R*step-G;
    const gs=Math.round(S*0.82), go=(S-gs)/2;
    let out='';
    const put=(svg,x,y)=>{ out+=String(svg).trim().replace(/^<svg\b/,'<svg x="'+x+'" y="'+y+'"'); };
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){
      const cd=board[r][c]; if(!cd.active) continue;
      const x=pad+c*step, y=pad+r*step;
      const sub=cd.sub&&OBS_TYPES.find(o=>o.id===cd.sub);
      out+='<rect x="'+x+'" y="'+y+'" width="'+S+'" height="'+S+'" rx="'+(sub?0:7)+'" fill="'+(sub?sub.color:'#d4b483')+'" stroke="'+(sub?sub.color:'#b8935a')+'" stroke-width="1.5"/>';
      if(cd.obs==='zeer') continue;                               // drawn whole, below
      const ot=cd.obs&&OBS_TYPES.find(o=>o.id===cd.obs);
      if(cd.gen){                                                 // generator: dark tile + the special it drops
        out+='<rect x="'+(x+go)+'" y="'+(y+go)+'" width="'+gs+'" height="'+gs+'" rx="'+(gs*.22)+'" fill="#1d1430" stroke="#7a5cc0" stroke-width="2"/>';
        put(puSVG(cd.gen.emit,Math.round(gs*.6)),x+S/2-gs*.3,y+S/2-gs*.3);
      }
      else if(cd.item){ const o=OBS_TYPES.find(o=>o.id===cd.item); if(o) put(obsSVG(o,gs,eggLook(r,c)),x+go,y+go); }
      else if(cd.pu) put(puSVG(cd.pu,gs),x+go,y+go);
      else if(!cd.startEmpty&&!(ot&&ot.solid)) put(gemSVG(pool[Math.floor(Math.random()*pool.length)],gs),x+go,y+go);
      if(cd.obs) put(overlaySVG(cd.obs,S),x,y);                   // chain / leaf / crate / fog on top
    }
    // Shedeh Zeers: one picture over each 2×2
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){
      const cd=board[r][c]; if(!cd.active||!cd.zeer) continue;
      put(zeerSVG({doors:'shut',jars:cd.zeer.jars},2*S+G),pad+c*step,pad+r*step);
    }
    // Barriers on the seams (same look as drawBarriers)
    const T=Math.max(6,Math.round(S*0.17)), over=Math.round(S*0.06);
    const bar=(x,y,w,h,t)=>{ out+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+(Math.min(w,h)/2)+'" fill="'+(t==='unbreakable'?'url(#pv-candy)':'#f2c230')+'" stroke="#1a1206" stroke-width="1.5"/>'; };
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const cd=board[r][c]; if(!cd.active) continue;
      if(cd.wallE&&c+1<C&&board[r][c+1].active) bar(pad+c*step+S+G/2-T/2, pad+r*step-over, T, S+2*over, cd.wallE);
      if(cd.wallS&&r+1<R&&board[r+1][c].active) bar(pad+c*step-over, pad+r*step+S+G/2-T/2, S+2*over, T, cd.wallS); }
    const defs='<defs><pattern id="pv-candy" width="'+(T*1.6)+'" height="'+(T*1.6)+'" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      +'<rect width="'+(T*1.6)+'" height="'+(T*1.6)+'" fill="#f2c230"/><rect width="'+(T*0.8)+'" height="'+(T*1.6)+'" fill="#111"/></pattern></defs>';
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'
      +defs+'<rect width="'+W+'" height="'+H+'" rx="12" fill="#1a1426"/>'+out+'</svg>';
    return {svg,w:W,h:H};
  } finally { board=keep.board; flow=keep.flow; R=keep.R; C=keep.C; }
}

// The board art is written for HTML, where named entities like &infin; are fine; a
// standalone SVG image is XML and refuses them. Rewrite each as its numeric code.
const XML_ENTITIES=new Set(['amp','lt','gt','quot','apos']);
function xmlSafe(svg){
  const t=document.createElement('textarea');
  return svg.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g,(m,name)=>{
    if(XML_ENTITIES.has(name)) return m;
    t.innerHTML=m; const cp=t.value.codePointAt(0);
    return t.value===m?'':'&#'+cp+';';           // unknown entity: drop it rather than break the picture
  });
}

// SVG → a compact image data: URL (WebP where the browser can encode it, else PNG),
// longest side capped so a 25-level bundle stays around a megabyte.
async function svgToImageURL(pic,maxSide){
  const scale=Math.min(1,(maxSide||420)/Math.max(pic.w,pic.h));
  const img=new Image();
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xmlSafe(pic.svg));
  await img.decode();
  const cv=document.createElement('canvas');
  cv.width=Math.round(pic.w*scale); cv.height=Math.round(pic.h*scale);
  cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
  const webp=cv.toDataURL('image/webp',0.82);
  return webp.startsWith('data:image/webp')?webp:cv.toDataURL('image/png');
}

// Draw + store every level's picture for one bundle (admin only — the database refuses
// anyone else). levels = the bundle's level array. Returns {ok, n} | {ok:false, error}.
async function makePreviewPictures(bundleId,levels){
  if(!Array.isArray(levels)||!levels.length) return {ok:false,error:'no levels'};
  const pics=[];
  for(const lv of levels){
    const pic=levelPictureSVG(lv);
    if(!pic) return {ok:false,error:'level '+(pics.length+1)+' is not a canonical level'};
    pics.push(await svgToImageURL(pic));
  }
  const res=await AkashicAuth.savePreviews(bundleId,pics);
  return res.ok?{ok:true,n:pics.length}:res;
}
// Admin button: (re)make the pictures for a bundle that's already published.
async function adminMakePictures(id,btn){
  if(btn){ btn.disabled=true; btn.textContent='Drawing…'; }
  const row=await AkashicAuth.getBundle(id);
  const res=row&&Array.isArray(row.data)?await makePreviewPictures(id,row.data):{ok:false,error:'could not read the levels'};
  if(btn){ btn.disabled=false; btn.textContent=res.ok?'✓ '+res.n+' pictures':'Make pictures'; }
  if(!res.ok) alert('Pictures failed: '+res.error);
}

// ── THE STORE SHEET ─────────────────────────────────────────────────────────
// Opens instead of going straight to checkout when a shopper taps a paid bundle they
// don't own: every level's picture, a 10-move test of level 1, and the Buy button.
async function openBundlePreview(id){
  const b=communityRows.find(r=>r.id===id); if(!b) return;
  const n=b.levels||0, a=b.first_level||1;
  const ended=previewEnded&&previewEnded.id===id?previewEnded:null; previewEnded=null;
  const box=document.getElementById('bpreview-body');
  box.innerHTML=
     '<div class="bp-head"><div><div class="bp-title">'+escHtml(b.title)+'</div>'
    +'<div class="bp-meta">'+TXT('community_by')(escHtml(b.author_name||'?'))
    +(b.family_id?' · '+escHtml(b.family_name)+' · '+TXT('fam_chapter')(b.family_seq):'')
    +' · '+TXT('fam_levels')(a,a+n-1)+'</div></div>'
    +'<button class="bp-x" onclick="closeBundlePreview()" aria-label="Close">✕</button></div>'
    +(ended?'<div class="bp-ended">'+escHtml(ended.won?TXT('pv_won')(b.title):TXT('pv_over')(PREVIEW_MOVES,b.title))+'</div>':'')
    +'<div class="bp-actions">'
    +'<button class="bp-btn go" onclick="startBundlePurchase('+id+')">'+TXT('buy_btn')(b.price_cents)+'</button>'
    +'<button class="bp-btn" onclick="startPreviewPlay('+id+')">'+TXT('pv_try')(a,PREVIEW_MOVES)+'</button></div>'
    +'<div class="bp-grid" id="bp-grid"><div class="bp-empty">'+TXT('pv_loading')+'</div></div>'
    +'<div class="bp-big" id="bp-big" onclick="this.classList.remove(\'open\')"></div>';
  document.getElementById('bpreview').classList.add('open');
  const pics=await AkashicAuth.getPreviews(id);
  const grid=document.getElementById('bp-grid'); if(!grid) return;
  grid.innerHTML=pics.length
    ? pics.map(p=>'<div class="bp-cell" onclick="bpEnlarge(this)"><img src="'+p.image+'" alt="" loading="lazy"><span>'+(a+p.level-1)+'</span></div>').join('')
    : '<div class="bp-empty">'+TXT('pv_none')+'</div>';
}
function closeBundlePreview(){ document.getElementById('bpreview').classList.remove('open'); }
// Tap a picture → it fills the sheet; tap again → back to the grid.
function bpEnlarge(cell){
  const big=document.getElementById('bp-big'); if(!big) return;
  big.innerHTML='<img src="'+cell.querySelector('img').src+'" alt=""><span>'+TXT('lvl_prefix')+cell.querySelector('span').textContent+'</span>';
  big.classList.add('open');
}

// ── THE 10-MOVE TEST ────────────────────────────────────────────────────────
// Level 1 only, played on the real board. A scratch progress bucket (-1) keeps every
// star read harmless; playerFinish hands a preview to previewFinish before it could
// write anything, and the bucket is dropped on the way out.
async function startPreviewPlay(id){
  const b=communityRows.find(r=>r.id===id); if(!b) return;
  const json=await AkashicAuth.getPreviewLevel(id);
  if(!json){ alert(TXT('pv_fail')); return; }
  closeBundlePreview();
  previewMode={id};
  curBundle={ id, title:b.title, levels:[json], preview:true,
              first_level:b.first_level||1, family_name:b.family_name, family_seq:b.family_seq };
  PlayerProgress.bundle=-1;
  startCommunityLevel(1);
}
// The test is over: a win, or the 10th move has settled. Lock the board, then back to
// the store sheet with a line saying so.
function previewFinish(won){
  if(!previewMode) return;
  playing=false; Motion.claim('overlay');
  previewEnded={id:previewMode.id,won:!!won};
  setTimeout(exitToGrid,900);   // a beat to see the last move land; no star fireworks — nothing was earned
}
// exitToGrid's last step while previewing: tidy up and reopen the store sheet.
function previewBackToStore(){
  const id=previewMode&&previewMode.id;
  previewMode=null; curBundle=null;
  delete PlayerProgress.data[-1]; PlayerProgress.bundle=0;
  renderBundles();
  if(id) openBundlePreview(id);
}
