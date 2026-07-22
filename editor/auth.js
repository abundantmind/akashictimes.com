// AkashicSwaps — auth + cloud-sync layer (magic-link, no passwords, no build step).
//
// This module is the ONLY place that talks to auth/progress in the cloud. It
// imports the shared Supabase client (db.js) and exposes a tiny global,
// `window.AkashicAuth`, that the main classic <script> calls into. It runs as a
// deferred ES module, so by the time it executes every global the game defined
// (PlayerProgress, TXT, renderGrid, LANG…) already exists on `window`.
//
// Design contract (from db/README.md):
//   • Logged-out play works EXACTLY as today — localStorage is the base tier.
//   • First sign-in MERGES local→cloud (nothing is thrown away), then the cloud
//     becomes the source and every star earned afterward is pushed live.
//   • The publishable key + RLS in schema.sql are the security boundary.
import { supabase } from './db.js';

// localStorage keys the game already uses — we mirror these into the cloud.
const LS = {
  player:   'akashicswaps-player',    // { level: {s:stars, rec:moveRecord} }
  qualified:'akashicswaps-qualified', // '1' once the entrance is cleared
  path:     'akashicswaps-path',      // 'architect' | 'explorer'
  lang:     'akashicswaps-lang'       // 'en' | 'ko'
};

// ── i18n for auth strings (EN + KR) — the game's I18N table is player-facing;
// we register our keys into it so TXT() and setLang() pick them up for free.
const AUTH_I18N = {
  en: {
    auth_signin:        '☁ Sign in — save your stars',
    auth_signed_as:     e => 'Signed in · ' + e,
    auth_signout:       'Sign out',
    auth_title:         'Save your stars',
    auth_msg:           'Enter your email and we\'ll send a one-tap sign-in link. No password, ever. Your stars, levels and progress then follow you to any device.',
    auth_email_ph:      'you@email.com',
    auth_send:          'Send link',
    auth_cancel:        'Not now',
    auth_sending:       'Sending…',
    auth_sent:          e => 'Link sent to ' + e + '. Check your inbox and tap it to finish.',
    auth_bad_email:     'That doesn\'t look like an email address.',
    auth_err:           'Couldn\'t send the link. Try again in a moment.',
    auth_merged:        'Signed in — your stars are now saved to the cloud. ☁',
    auth_syncing:       'Syncing your progress…'
  },
  ko: {
    auth_signin:        '☁ 로그인 — 별을 저장하세요',
    auth_signed_as:     e => '로그인됨 · ' + e,
    auth_signout:       '로그아웃',
    auth_title:         '별을 저장하세요',
    auth_msg:           '이메일을 입력하면 한 번의 탭으로 로그인되는 링크를 보내드립니다. 비밀번호는 필요 없습니다. 별과 레벨, 진행 상황이 어떤 기기에서든 따라옵니다.',
    auth_email_ph:      'you@email.com',
    auth_send:          '링크 보내기',
    auth_cancel:        '다음에요',
    auth_sending:       '보내는 중…',
    auth_sent:          e => e + ' 으로 링크를 보냈습니다. 받은편지함에서 눌러 완료하세요.',
    auth_bad_email:     '이메일 주소 형식이 아닌 것 같습니다.',
    auth_err:           '링크를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
    auth_merged:        '로그인 완료 — 별이 이제 클라우드에 저장됩니다. ☁',
    auth_syncing:       '진행 상황을 동기화하는 중…'
  }
};

// Splice our strings into the game's live I18N table so TXT()/setLang() see them.
function registerStrings(){
  if(!window.I18N) return;
  Object.assign(window.I18N.en, AUTH_I18N.en);
  Object.assign(window.I18N.ko, AUTH_I18N.ko);
}

// ── merge rules (db/README.md) ───────────────────────────────────────────────
// progress: keep MAX stars, MIN non-zero move record. Read the game's live
// PlayerProgress store rather than re-parsing localStorage — it's the same data,
// already normalized for old plain-number entries.
function localProgressRows(){
  const P = window.PlayerProgress;
  const rows = [];
  if(!P) return rows;
  Object.keys(P.data).forEach(k => {
    const n = +k; if(!n) return;
    rows.push({ level:n, stars:P.stars(n), move_record:P.record(n) });
  });
  return rows;
}

// Fold cloud rows back into the live PlayerProgress store + localStorage so the
// grid instantly reflects the union. Same MAX/MIN rule applied the other way.
function foldCloudIntoLocal(cloudRows){
  const P = window.PlayerProgress; if(!P) return;
  (cloudRows||[]).forEach(r => {
    const curS = P.stars(r.level), curR = P.record(r.level);
    const stars = Math.max(curS, r.stars);
    // MIN non-zero record across the two
    const recs = [curR, r.move_record].filter(x => x > 0);
    const rec = recs.length ? Math.min(...recs) : 0;
    P.data[r.level] = { s: stars, rec: rec };
  });
  P.save();
}

// The full first-sign-in reconciliation: pull cloud, merge with local both ways,
// push the union back up, then repaint. Idempotent — safe to run every sign-in.
async function reconcile(userId){
  // 1. profile (qualified OR, path server-wins, lang local-wins)
  const localQual = localStorage.getItem(LS.qualified) === '1';
  const localPath = localStorage.getItem(LS.path) || null;
  const localLang = localStorage.getItem(LS.lang) || 'en';
  const { data: prof } = await supabase
    .from('profiles').select('qualified,path,lang').eq('id', userId).maybeSingle();
  const mergedProfile = {
    qualified: (prof && prof.qualified) || localQual,           // OR
    path:      (prof && prof.path) || localPath,                // server wins if set
    lang:      localLang || (prof && prof.lang) || 'en'         // local wins (device pref)
  };
  await supabase.from('profiles').update(mergedProfile).eq('id', userId);
  // reflect a server-set path/qualified back onto this device so routing agrees
  if(mergedProfile.qualified) localStorage.setItem(LS.qualified, '1');
  if(mergedProfile.path) localStorage.setItem(LS.path, mergedProfile.path);

  // 2. progress — pull cloud, fold into local, push the union up
  const { data: cloudRows } = await supabase
    .from('progress').select('level,stars,move_record').eq('user_id', userId);
  foldCloudIntoLocal(cloudRows);
  const union = localProgressRows().map(r => ({
    user_id: userId, level: r.level, stars: r.stars, move_record: r.move_record
  }));
  if(union.length){
    // onConflict on the (user_id, level) PK — one authoritative row per level.
    await supabase.from('progress').upsert(union, { onConflict: 'user_id,level' });
  }
}

// Push a single level's living state after it changes mid-play (star earned).
async function pushLevel(n){
  const u = AkashicAuth.user; if(!u) return;
  const P = window.PlayerProgress; if(!P) return;
  const row = { user_id: u.id, level: n, stars: P.stars(n), move_record: P.record(n) };
  const { error } = await supabase.from('progress').upsert(row, { onConflict: 'user_id,level' });
  if(error) console.warn('[auth] progress push failed', error.message); // localStorage already has it; non-fatal
}

// ── the public surface the game calls ────────────────────────────────────────
const AkashicAuth = {
  user: null,   // Supabase user object when signed in, else null
  ready: false, // true once the initial session check has resolved

  // Open the magic-link modal. Rebuilt fresh each open so its strings always
  // match the current language (LANG can change between opens).
  open(){
    const existing = document.getElementById('authbox');
    if(existing) existing.remove();
    buildModal();
    document.getElementById('authbox').classList.add('open');
    setTimeout(() => { const i = document.getElementById('auth-email'); if(i) i.focus(); }, 30);
  },
  close(){ const b = document.getElementById('authbox'); if(b) b.classList.remove('open'); },

  async sendLink(){
    const input = document.getElementById('auth-email');
    const status = document.getElementById('auth-status');
    const email = (input.value || '').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ status.textContent = TXT('auth_bad_email'); return; }
    status.textContent = TXT('auth_sending');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Return to whatever origin+path we're on — works for localhost AND
      // akashictimes.com, provided both are in Supabase's allowed redirect list.
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    status.textContent = error ? TXT('auth_err') : TXT('auth_sent')(email);
  },

  async signOut(){
    await supabase.auth.signOut();
    // user cleared via onAuthStateChange; localStorage stars stay put (base tier)
  },

  // Called from renderGrid() to paint the sign-in strip in the right state.
  stripHTML(){
    if(this.user){
      const email = this.user.email || '';
      return '<div class="auth-strip">'
        + '<span class="auth-who">' + TXT('auth_signed_as')(email) + '</span>'
        + '<button class="auth-out" onclick="AkashicAuth.signOut()">' + TXT('auth_signout') + '</button>'
        + '</div>';
    }
    return '<div class="auth-strip">'
      + '<button class="auth-in" onclick="AkashicAuth.open()">' + TXT('auth_signin') + '</button>'
      + '</div>';
  }
};
window.AkashicAuth = AkashicAuth;

// Build the modal DOM once, injected at end of <body>, mirroring #qsurvey.
function buildModal(){
  if(document.getElementById('authbox')) return;
  const wrap = document.createElement('div');
  wrap.id = 'authbox';
  wrap.innerHTML =
    '<div class="wbox">'
    + '<h2>' + TXT('auth_title') + '</h2>'
    + '<p class="wmsg" id="auth-copy">' + TXT('auth_msg') + '</p>'
    + '<input id="auth-email" type="email" autocomplete="email" inputmode="email" placeholder="' + TXT('auth_email_ph') + '">'
    + '<div class="auth-status" id="auth-status"></div>'
    + '<div class="auth-btns">'
    +   '<button class="auth-send" onclick="AkashicAuth.sendLink()">' + TXT('auth_send') + '</button>'
    +   '<button class="auth-no" onclick="AkashicAuth.close()">' + TXT('auth_cancel') + '</button>'
    + '</div></div>';
  document.body.appendChild(wrap);
  // Enter submits from the email field
  wrap.querySelector('#auth-email').addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); AkashicAuth.sendLink(); }
  });
}

// Repaint any live auth surface (the grid strip) after a state change. We detect
// "the Levels grid is showing" purely from the DOM — #pgrid-title exists only
// when renderGrid() painted last — since lastPView is classic-script-scoped and
// invisible to this module.
function refreshUI(){
  if(document.getElementById('pgrid-title') && typeof renderGrid === 'function'){
    renderGrid();
  }
}

// ── wire-up on load ──────────────────────────────────────────────────────────
registerStrings();

// Intercept every star write so a signed-in player's progress goes to the cloud
// too. localStorage still gets written first (original set), so logged-out and
// offline play are untouched; the cloud push is best-effort on top.
(function hookProgress(){
  const P = window.PlayerProgress; if(!P) return;
  const origSet = P.set.bind(P);
  P.set = function(n, s, rec){ origSet(n, s, rec); pushLevel(n); };
})();

// React to sign-in / sign-out for the whole session lifecycle.
supabase.auth.onAuthStateChange(async (event, session) => {
  AkashicAuth.user = session ? session.user : null;
  if(event === 'SIGNED_IN' && AkashicAuth.user){
    AkashicAuth.close();
    const status = document.getElementById('auth-status');
    if(status) status.textContent = TXT('auth_syncing');
    try { await reconcile(AkashicAuth.user.id); } catch(e){ console.warn('[auth] reconcile failed', e); }
  }
  refreshUI();
});

// Resolve the initial session (returning signed-in visitor, or a fresh
// magic-link redirect that the client auto-detected from the URL).
(async () => {
  const { data } = await supabase.auth.getSession();
  AkashicAuth.user = data.session ? data.session.user : null;
  AkashicAuth.ready = true;
  refreshUI();
})();
