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

// ── DURABLE IDENTITY (Jed 2026-08-15 — db/002 shipped the real columns) ──────
// The old SEED_USERNAMES bridge is GONE. profiles now carries the real columns:
//   • handle   — the generated anon handle (identity.js), server copy, NON-unique
//   • username — the chosen display override, UNIQUE
// syncIdentity() is the read side (server-wins on load, migrate a local name up
// once); pushUsername() is the write side (Settings edits flow to the DB).
// `applyingRemote` guards the write-hook from echoing a server-applied value back.
let applyingRemote = false;

// Read side: reconcile this device's identity with the server for a signed-in
// user (anonymous or permanent). A durable server username wins if present;
// otherwise a name already chosen locally (e.g. an older localStorage override)
// is migrated up once. The generated handle fills the server handle column the
// first time so an opted-in anon player shows their handle on the leaderboard.
async function syncIdentity(userId){
  if(!window.AkashicID) return;
  const { data: prof } = await supabase
    .from('profiles').select('username,handle').eq('id', userId).maybeSingle();
  if(!prof) return;
  const localName   = AkashicID.username();   // chosen override in localStorage ('' if none)
  const localHandle = AkashicID.ensure();     // generated handle (mints if somehow absent)
  const patch = {};
  if(prof.username){
    applyingRemote = true;                     // adopt the durable name WITHOUT re-pushing it
    AkashicID.setUsername(prof.username);
    applyingRemote = false;
  } else if(localName){
    patch.username = localName;                // migrate a pre-existing local name to durable storage
  }
  if(!prof.handle && localHandle) patch.handle = localHandle; // seed the server handle once
  if(Object.keys(patch).length){
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if(error) console.warn('[auth] identity sync failed', error.message); // unique clash etc. — non-fatal
  }
}

// Write side: a Settings edit to the display name (AkashicID.setUsername/clear)
// is mirrored to profiles.username for the signed-in user. Hooked at wire-up.
async function pushUsername(name){
  if(applyingRemote) return;                   // don't echo a server-applied value back up
  const u = AkashicAuth.user; if(!u) return;
  const { error } = await supabase.from('profiles')
    .update({ username: name || null }).eq('id', u.id);
  if(error) console.warn('[auth] username push failed', error.message);
}

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
  },
  es: {
    auth_signin:        '☁ Inicia sesión — guarda tus estrellas',
    auth_signed_as:     e => 'Sesión iniciada · ' + e,
    auth_signout:       'Cerrar sesión',
    auth_title:         'Guarda tus estrellas',
    auth_msg:           'Escribe tu correo y te enviaremos un enlace de acceso con un solo toque. Sin contraseñas, nunca. Tus estrellas, niveles y progreso te seguirán a cualquier dispositivo.',
    auth_email_ph:      'tu@correo.com',
    auth_send:          'Enviar enlace',
    auth_cancel:        'Ahora no',
    auth_sending:       'Enviando…',
    auth_sent:          e => 'Enlace enviado a ' + e + '. Revisa tu bandeja de entrada y tócalo para terminar.',
    auth_bad_email:     'Eso no parece una dirección de correo.',
    auth_err:           'No se pudo enviar el enlace. Inténtalo de nuevo en un momento.',
    auth_merged:        'Sesión iniciada — tus estrellas ahora están guardadas en la nube. ☁',
    auth_syncing:       'Sincronizando tu progreso…'
  }
};

// Splice our strings into the game's live I18N table so TXT()/setLang() see them.
function registerStrings(){
  if(!window.I18N) return;
  Object.assign(window.I18N.en, AUTH_I18N.en);
  Object.assign(window.I18N.ko, AUTH_I18N.ko);
  Object.assign(window.I18N.es, AUTH_I18N.es);
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

  // 3. identity — durable handle + username (server-wins, migrate a local name up once)
  await syncIdentity(userId);
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

  // ── Leaderboard layer (db/002: standings() + profiles.stars_public) ──────────
  // The board is the ONE global ranking: opted-in players by total stars, then
  // reach (current level). standings() is a SECURITY DEFINER read, open to all so
  // the board can be previewed; appearing on it is the player's own opt-in below.
  async standings(){
    const { data, error } = await supabase.rpc('standings');
    if(error){ console.warn('[auth] standings failed', error.message); return []; }
    return data || [];
  },
  // Read the signed-in player's board visibility (default private). No user (auth
  // not ready / disabled) → treat as private.
  async getStarsPublic(){
    const u = this.user; if(!u) return false;
    const { data, error } = await supabase.from('profiles')
      .select('stars_public').eq('id', u.id).maybeSingle();
    if(error){ console.warn('[auth] stars_public read failed', error.message); return false; }
    return !!(data && data.stars_public);
  },
  // Flip the opt-in. RLS ("update own profile") scopes this to the caller's row.
  // Returns true on success so the UI can revert the checkbox if the write fails.
  async setStarsPublic(on){
    const u = this.user; if(!u) return false;
    const { error } = await supabase.from('profiles')
      .update({ stars_public: !!on }).eq('id', u.id);
    if(error){ console.warn('[auth] stars_public write failed', error.message); return false; }
    return true;
  },

  // ── Marketplace submission (schema.sql's public.bundles, live since v1 —
  // never wired to a UI until now). Inserts a DRAFT row: published defaults to
  // false, so it's invisible to everyone but its author until Jed hand-approves
  // it (Wizard-of-Oz moderation, [[project_marketplace_pivot]]) by flipping
  // `published` in the Supabase SQL editor — no admin UI needed at this volume.
  // `levels` = the array of canonical serializeLevel() outputs already written
  // to the architect's local bundle folder; `data` just carries them as-is.
  async submitBundle({ title, levels }){
    const u = this.user; if(!u) return { ok:false, error:'not signed in' };
    if(!title || !levels || !levels.length) return { ok:false, error:'nothing to submit' };
    const { data, error } = await supabase.from('bundles')
      .insert({ author: u.id, title: title.slice(0,80), data: levels, published: false })
      .select('id').maybeSingle();
    if(error){ console.warn('[auth] submitBundle failed', error.message); return { ok:false, error: error.message }; }
    return { ok:true, id: data && data.id };
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
  // Once a session resolves, the username override may have changed — repaint the
  // editor home + Profile menu so "Welcome back, {name}", the bundle labels, and
  // the profile name/sign-in state all reflect it.
  if(typeof window.updateHome === 'function') window.updateHome();
  if(typeof window.updateProfile === 'function') window.updateProfile();
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

// Mirror Settings edits to the display name into profiles.username for a signed-in
// user. Wraps AkashicID so index.html's Settings UI needs NO changes (same pattern
// as the PlayerProgress.set hook above). syncIdentity's own setUsername is guarded
// by applyingRemote, so adopting the server name never bounces back up.
(function hookIdentity(){
  if(!window.AkashicID) return;
  const origSet = AkashicID.setUsername.bind(AkashicID);
  AkashicID.setUsername = function(u){ origSet(u); pushUsername(u); };
  const origClear = AkashicID.clearUsername.bind(AkashicID);
  AkashicID.clearUsername = function(){ origClear(); pushUsername(null); };
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
  if(event === 'SIGNED_OUT' && window.AkashicID){
    AkashicID.clearUsername(); // drop the real-name override; the generated handle stays as the anon identity
  }
  refreshUI();
});

// Resolve the initial session (returning signed-in visitor, or a fresh
// magic-link redirect that the client auto-detected from the URL).
(async () => {
  let { data } = await supabase.auth.getSession();
  let freshAnon = false;
  if(!data.session){
    // No session at all → mint an ANONYMOUS one so every visitor has a real
    // server identity (auth.uid()) that can hold progress + a leaderboard seat
    // WITHOUT an email (Jed 2026-08-15). Requires Auth → Anonymous sign-ins ON.
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if(error){ console.warn('[auth] anonymous sign-in failed', error.message); }
    else if(anon && anon.session){ data = { session: anon.session }; freshAnon = true; }
    // the SIGNED_IN event fires for the fresh anon user → reconcile()+syncIdentity run there
  }
  AkashicAuth.user = data.session ? data.session.user : null;
  // A RESTORED session (returning anon or permanent) does NOT fire SIGNED_IN, so
  // reconcile won't run — pull the durable identity here so "Welcome back, {name}"
  // reflects the server on every load. (freshAnon is already covered via SIGNED_IN.)
  if(AkashicAuth.user && !freshAnon){
    try { await syncIdentity(AkashicAuth.user.id); } catch(e){ console.warn('[auth] identity sync failed', e); }
  }
  AkashicAuth.ready = true;
  refreshUI();
})();
