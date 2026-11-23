// ═══ SHEDEH ZEER ART (Jed 2026-11-22) ═══════════════════════════════════════
// The Zeer is Egypt's clay refrigerator; here it is a 2×2 terracotta cabinet with
// two acacia-wood doors, holding 8 sealed jars of Shedeh (the pharaohs' dark red
// pomegranate drink) on two shelves of four.
//   zeerSVG({doors:'shut'|'open', jars:0..8}, px) → one SVG that spans the 2×2 block
//   shedehJarSVG(px)                              → a single jar (goal icon / HUD)
// Animation-contrast rule: dark outlines + saturated bodies so it reads on the
// light sand cells. Jars leave in reading order (top shelf first, left to right).

// One sealed Shedeh jar, drawn in a w×h box whose top-left is (x,y). Clay body,
// pomegranate-red wax seal + band, dark outline.
function shedehJarPath(x,y,w,h){
  const cx=x+w/2, ink='#2a0e05';
  return ''
    // body: a fat amphora — shoulders, belly, narrow foot
    +`<path d="M ${cx-w*.18} ${y+h*.22} C ${cx-w*.48} ${y+h*.30}, ${cx-w*.50} ${y+h*.78}, ${cx-w*.16} ${y+h*.95}`
    +` L ${cx+w*.16} ${y+h*.95} C ${cx+w*.50} ${y+h*.78}, ${cx+w*.48} ${y+h*.30}, ${cx+w*.18} ${y+h*.22} Z"`
    +` fill="#c8743a" stroke="${ink}" stroke-width="${w*.07}" stroke-linejoin="round"/>`
    // pomegranate band round the belly — the Shedeh showing through
    +`<path d="M ${cx-w*.40} ${y+h*.55} Q ${cx} ${y+h*.64} ${cx+w*.40} ${y+h*.55} L ${cx+w*.38} ${y+h*.68} Q ${cx} ${y+h*.77} ${cx-w*.38} ${y+h*.68} Z" fill="#a0102e"/>`
    // neck
    +`<rect x="${cx-w*.14}" y="${y+h*.10}" width="${w*.28}" height="${h*.14}" fill="#b0602c" stroke="${ink}" stroke-width="${w*.06}"/>`
    // red wax seal on top
    +`<ellipse cx="${cx}" cy="${y+h*.09}" rx="${w*.22}" ry="${h*.07}" fill="#c4143c" stroke="${ink}" stroke-width="${w*.06}"/>`
    // a highlight so it reads as round clay
    +`<path d="M ${cx-w*.26} ${y+h*.40} Q ${cx-w*.30} ${y+h*.50} ${cx-w*.24} ${y+h*.62}" fill="none" stroke="#f0b27a" stroke-width="${w*.06}" stroke-linecap="round" opacity=".8"/>`;
}

function shedehJarSVG(px){
  const s=px||34;
  return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${shedehJarPath(18,6,64,90)}</svg>`;
}

function zeerSVG(state,px){
  const s=px||96, ink='#2a0e05';
  const jars=Math.max(0,Math.min(8,state&&state.jars!=null?state.jars:8));
  const shut=state&&state.doors==='shut';
  let g='';
  // ── the terracotta housing: thick clay frame, Egyptian cavetto cornice on top ──
  g+=`<rect x="3" y="9" width="94" height="88" rx="6" fill="#8a3a18" stroke="${ink}" stroke-width="3"/>`;
  g+=`<path d="M 1 13 Q 50 2 99 13 L 99 19 L 1 19 Z" fill="#6a2a10" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>`; // cornice
  g+=`<rect x="5" y="16" width="90" height="3" fill="#d9a441"/>`;                                    // gold band
  // ── the niche (dark, so the jars pop) ──
  g+=`<rect x="10" y="23" width="80" height="68" rx="3" fill="#2a1208" stroke="${ink}" stroke-width="2"/>`;
  // two shelves
  g+=`<rect x="10" y="55" width="80" height="4" fill="#6a3416"/>`;
  g+=`<rect x="10" y="87" width="80" height="4" fill="#6a3416"/>`;
  // ── 8 jars, 4 per shelf; the first (8 - jars) in reading order are gone ──
  const gone=8-jars;
  for(let i=0;i<8;i++){
    if(i<gone)continue;
    const row=Math.floor(i/4), col=i%4;
    g+=shedehJarPath(12+col*19.5, 26+row*32, 18, 29);
  }
  // ── shut doors: two acacia panels over the niche, gold ring pulls at the seam ──
  if(shut){
    for(const [x,flip] of [[10,false],[50,true]]){
      g+=`<rect x="${x}" y="23" width="40" height="68" fill="#5a3416" stroke="${ink}" stroke-width="2"/>`;
      g+=`<line x1="${x+13.3}" y1="25" x2="${x+13.3}" y2="89" stroke="#3e2410" stroke-width="1.5"/>`; // planks
      g+=`<line x1="${x+26.6}" y1="25" x2="${x+26.6}" y2="89" stroke="#3e2410" stroke-width="1.5"/>`;
      g+=`<rect x="${x+5}" y="30" width="30" height="5" fill="#2f6fb0" stroke="${ink}" stroke-width="1"/>`;  // faience inlay
      g+=`<rect x="${x+5}" y="79" width="30" height="5" fill="#2f6fb0" stroke="${ink}" stroke-width="1"/>`;
      // pomegranate badge on each door: tells you what's inside
      g+=`<circle cx="${x+20}" cy="57" r="8" fill="#a0102e" stroke="${ink}" stroke-width="2"/>`;
      g+=`<path d="M ${x+16} 50 L ${x+18} 47 L ${x+20} 50 L ${x+22} 47 L ${x+24} 50" fill="#a0102e" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      const px2=flip?x+4:x+36;                                                                     // pull sits by the seam
      g+=`<circle cx="${px2}" cy="62" r="3" fill="none" stroke="#d9a441" stroke-width="2"/>`;
    }
    g+=`<line x1="50" y1="23" x2="50" y2="91" stroke="${ink}" stroke-width="2.5"/>`;               // the seam
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
