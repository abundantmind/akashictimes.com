// ═══ DESERT FOG ART (Jed 2026-11-23) ═════════════════════════════════════════
// Desert Fog is the dusty morning fog that rolls off the desert road: a solid billow
// that fills its cell, holds no gem, and creeps into a neighbouring gem cell on any
// move that leaves its region untouched.
//   fogSVG(px)     → one cell of fog (board overlay + palette swatch)
//   fogIconSVG(px) → the goal icon (HUD, goal list, help card)
// Animation-contrast rule: a dark taupe outline + mid-tone dusty body, so it reads on
// the light sand cells (pale grey fog vanished against them).

// The billow outline: four lobes round a square, so neighbouring fog cells read as one
// rolling bank. Drawn in a 100×100 box.
const FOG_BILLOW='M 18 30 C 14 14, 34 6, 44 16 C 52 4, 74 6, 78 20 C 94 20, 98 40, 88 50'
  +' C 98 62, 90 84, 74 82 C 68 96, 44 98, 38 86 C 22 94, 4 80, 12 64 C 0 56, 2 34, 18 30 Z';

function fogSVG(px){
  const s=px||34, ink='#4e3f28';
  return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`
    // a square base under the billow so a fog region has no sand gaps between cells
    +`<rect x="2" y="2" width="96" height="96" rx="10" fill="#b9a988"/>`
    // the billow itself — dusty body, dark outline
    +`<path d="${FOG_BILLOW}" fill="#cdbf9f" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`
    // drifting swirls: the fog is moving
    +`<path d="M 26 46 C 36 36, 52 38, 56 48 C 60 58, 74 58, 78 48" fill="none" stroke="#7a6848" stroke-width="5" stroke-linecap="round"/>`
    +`<path d="M 24 66 C 34 60, 46 62, 52 68" fill="none" stroke="#7a6848" stroke-width="4" stroke-linecap="round"/>`
    // a pale lit edge on top, so it reads as a soft volume rather than a flat blob
    +`<path d="M 24 28 C 30 18, 40 16, 46 24" fill="none" stroke="#f3ead4" stroke-width="5" stroke-linecap="round" opacity=".9"/>`
    +`</svg>`;
}

// The goal icon: the same billow on its own (no square base), a touch bolder.
function fogIconSVG(px){
  const s=px||34, ink='#4e3f28';
  return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`
    +`<path d="${FOG_BILLOW}" fill="#cdbf9f" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>`
    +`<path d="M 26 46 C 36 36, 52 38, 56 48 C 60 58, 74 58, 78 48" fill="none" stroke="#7a6848" stroke-width="7" stroke-linecap="round"/>`
    +`<path d="M 24 28 C 30 18, 40 16, 46 24" fill="none" stroke="#f3ead4" stroke-width="6" stroke-linecap="round"/>`
    +`</svg>`;
}
