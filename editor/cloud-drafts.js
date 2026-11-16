// ═══════════════════════════════════════════════════════════════════════════
// CLOUD DRAFTS — the Architect's account is the home for bundles being built
// (Jed 2026-11-15: "Everything is moving towards the cloud.")
//
// Before this, a draft bundle was a FOLDER on the Architect's computer, reached through
// the File System Access API, which only desktop Chrome/Edge have. iPads and Android
// tablets couldn't build at all. Now:
//
//   · A draft = a set of named text files, exactly what the folder held: bundle.json +
//     level-0NN.json. Same names, same bytes, so approvals (a SHA-256 of a file's text)
//     carry over and Export writes back the same folder an AI or the Bundle Dev Kit (BDK) would produce.
//   · DEVICE FIRST. Every write lands in IndexedDB at once and is marked dirty; a sync
//     sends dirty files to Supabase (db/016) whenever there's a connection and a
//     signed-in user. Offline on a plane = keep building; it syncs on landing.
//   · Two devices editing one level: the later EDIT wins (editedAt is stamped at the
//     moment of the edit), never the later upload. The server enforces the same rule
//     (save_draft_file), so a tablet that was offline for hours can't clobber newer work.
//   · CloudDrafts.dir(id) returns a stand-in for a FileSystemDirectoryHandle with the
//     handful of methods the editor already calls (getFileHandle, entries, getFile,
//     createWritable, queryPermission). That's why save / approve / submit / the level
//     grid needed no changes: they don't know whether a bundle is a folder or a draft.
//
// Drafts made while nobody is signed in (localhost testing) belong to no one yet
// (author null); the first signed-in sync claims them for that user. A draft owned by a
// different user than the one signed in is never listed or sent.
//
// Classic script (not a module) so the editor's main script can call it at parse time.
// The network calls live in auth.js (draftsPull / draftUpsert / draftFileSave); tests
// swap CloudDrafts.backend for a fake.
// ═══════════════════════════════════════════════════════════════════════════
(function(){
  const DB_NAME = 'akashic-cloud', DB_VER = 1;
  const SYNC_DELAY = 1500;          // ms after the last edit before a sync starts (typing bursts batch up)

  // ── IndexedDB plumbing ────────────────────────────────────────────────────
  // drafts: {id, orientation:'landscape'|'portrait', author:uuid|null, createdAt, dirty}
  // files:  {draftId, name, body, editedAt:ISO, dirty}   key [draftId, name]
  // meta:   'lastPull:<uid>' → the newest server updated_at seen (incremental pulls)
  let _db = null;
  function db(){
    if(_db) return _db;
    _db = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('drafts', { keyPath:'id' });
        d.createObjectStore('files', { keyPath:['draftId','name'] }).createIndex('byDraft', 'draftId');
        d.createObjectStore('meta');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { _db = null; rej(r.error); };
    });
    return _db;
  }
  // One request in one transaction → its result.
  async function req(store, mode, fn){
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, mode), q = fn(tx.objectStore(store));
      let out; if(q) q.onsuccess = () => { out = q.result; };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  const getDraft  = id => req('drafts', 'readonly', s => s.get(id));
  const putDraft  = d  => req('drafts', 'readwrite', s => s.put(d));
  const allDrafts = () => req('drafts', 'readonly', s => s.getAll());
  const getFile   = (id, name) => req('files', 'readonly', s => s.get([id, name]));
  const putFile   = f  => req('files', 'readwrite', s => s.put(f));
  const draftFiles= id => req('files', 'readonly', s => s.index('byDraft').getAll(id));
  const allFiles  = () => req('files', 'readonly', s => s.getAll());
  const getMeta   = k  => req('meta', 'readonly', s => s.get(k));
  const putMeta   = (k, v) => req('meta', 'readwrite', s => s.put(v, k));

  // ── who's signed in (null = nobody: drafts stay on this device) ───────────
  // An ANONYMOUS session (production mints one for every visitor) counts as nobody: its
  // uid dies with the browser, and signing in by email later makes a different uid, so
  // drafts tied to it would vanish from the list. They stay unowned until a real
  // (email) sign-in claims them.
  const uid = () => { const b = CloudDrafts.backend, u = b && b.user; return u && !u.is_anonymous ? u.id : null; };
  // A draft is MINE if I own it, or nobody owns it yet (made signed-out on this device).
  const mine = d => d && (d.author == null || d.author === uid());

  // A new draft id, made here so a draft can be born offline.
  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); }));

  // Monotonic edit stamps: two saves in the same millisecond still order correctly.
  let lastStamp = 0;
  const stamp = () => { const t = Math.max(Date.now(), lastStamp + 1); lastStamp = t; return new Date(t).toISOString(); };

  // ── the folder stand-in ───────────────────────────────────────────────────
  // Only what the editor calls on a bundle's `dir`. A file that was never written reads
  // as '' (the editor always writes before it reads, except bundle.json probes, which
  // already treat '' / bad JSON as "no manifest").
  function CloudFile(draftId, name){ this.kind = 'file'; this.name = name; this._d = draftId; }
  CloudFile.prototype.getFile = async function(){
    const rec = await getFile(this._d, this.name), body = rec ? rec.body : '';
    return { name: this.name, size: body.length, text: async () => body };
  };
  CloudFile.prototype.createWritable = async function(){
    let buf = ''; const self = this;
    return {
      write: async s => { buf += (typeof s === 'string') ? s : (s && s.data != null ? String(s.data) : String(s)); },
      close: async () => { await CloudDrafts.write(self._d, self.name, buf); }
    };
  };
  function CloudDir(id){ this.kind = 'directory'; this.name = id; this.id = id; this.cloud = true; }
  CloudDir.prototype.queryPermission   = async () => 'granted';   // it's your account: nothing to grant
  CloudDir.prototype.requestPermission = async () => 'granted';
  CloudDir.prototype.getFileHandle = async function(name, opts){
    const rec = await getFile(this.id, name);
    if(!rec && !(opts && opts.create)){ const e = new Error(name + ' not found'); e.name = 'NotFoundError'; throw e; }
    return new CloudFile(this.id, name);
  };
  CloudDir.prototype.entries = async function*(){
    const fs = (await draftFiles(this.id)).map(f => f.name).sort();
    for(const n of fs) yield [n, new CloudFile(this.id, n)];
  };
  CloudDir.prototype.keys = async function*(){ for await (const [n] of this.entries()) yield n; };

  // ── sync state, shown in the bundle list ──────────────────────────────────
  const state = { syncing:false, lastSync:null, error:null, pending:0 };
  let timer = null, running = null;
  const emit = changed => { try{ window.dispatchEvent(new CustomEvent('cloud-drafts', { detail:{ changed:!!changed, state:Object.assign({}, state) } })); }catch(e){} };
  async function countPending(){
    const ds = (await allDrafts()).filter(mine), ids = new Set(ds.map(d => d.id));
    state.pending = ds.filter(d => d.dirty).length + (await allFiles()).filter(f => f.dirty && ids.has(f.draftId)).length;
    return state.pending;
  }

  // ── PULL: take every server change newer than what this device has ────────
  // Per file: no local copy → take it. Local copy clean → take the server's if it differs.
  // Local copy DIRTY (edited here, not sent yet) → keep whichever edit is LATER.
  async function pull(u){
    const b = CloudDrafts.backend, key = 'lastPull:' + u;
    const since = await getMeta(key);
    const r = await b.draftsPull(since || null);
    if(!r.ok) throw new Error(r.error || 'pull failed');
    let changed = false, newest = since || null;
    for(const sd of r.drafts){
      const ld = await getDraft(sd.id);
      if(!ld){ await putDraft({ id:sd.id, orientation:sd.orientation, author:u, createdAt:sd.created_at, dirty:false }); changed = true; }
    }
    for(const sf of r.files){
      if(!newest || sf.updated_at > newest) newest = sf.updated_at;
      const lf = await getFile(sf.draft_id, sf.name);
      const take = !lf || (lf.dirty ? Date.parse(sf.edited_at) > Date.parse(lf.editedAt) : lf.body !== sf.body);
      if(take){ await putFile({ draftId:sf.draft_id, name:sf.name, body:sf.body, editedAt:sf.edited_at, dirty:false }); changed = true; }
    }
    if(newest && newest !== since) await putMeta(key, newest);
    return changed;
  }

  // ── PUSH: send every dirty draft row and file of mine ─────────────────────
  async function push(u){
    const b = CloudDrafts.backend;
    for(const d of await allDrafts()){
      if(!mine(d)) continue;
      if(d.author == null){ d.author = u; d.dirty = true; await putDraft(d); }   // claim a signed-out draft
      if(d.dirty){
        const r = await b.draftUpsert({ id:d.id, orientation:d.orientation });
        if(!r.ok) throw new Error(r.error || 'draft upsert failed');
        const cur = await getDraft(d.id); if(cur){ cur.dirty = false; await putDraft(cur); }
      }
      for(const f of await draftFiles(d.id)){
        if(!f.dirty) continue;
        const r = await b.draftFileSave({ draftId:f.draftId, name:f.name, body:f.body, editedAt:f.editedAt });
        if(!r.ok) throw new Error(r.error || 'file save failed');
        // saved:false = the server holds a NEWER edit (another device); the next pull brings it.
        // Either way this copy is no longer waiting to go up, unless it was edited again meanwhile.
        const cur = await getFile(f.draftId, f.name);
        if(cur && cur.editedAt === f.editedAt){ cur.dirty = false; await putFile(cur); }
      }
    }
  }

  const CloudDrafts = {
    backend: null,           // set to window.AkashicAuth once it loads (auth.js is a deferred module)
    state,
    dir: id => new CloudDir(id),

    // My drafts on this device: [{id, orientation, createdAt, manifest}] (manifest = parsed bundle.json or {}).
    async list(){
      const out = [];
      for(const d of await allDrafts()){
        if(!mine(d)) continue;
        const m = await getFile(d.id, 'bundle.json');
        let manifest = {}; try{ manifest = m && m.body ? JSON.parse(m.body) : {}; }catch(e){}
        out.push({ id:d.id, orientation:d.orientation, createdAt:d.createdAt, manifest });
      }
      return out;
    },

    // A new draft with its starting files ({name: text}). Returns its id.
    async create(orientation, files){
      const id = newId();
      await putDraft({ id, orientation:String(orientation).toLowerCase(), author:uid(), createdAt:new Date().toISOString(), dirty:true });
      for(const [name, body] of Object.entries(files || {})) await putFile({ draftId:id, name, body, editedAt:stamp(), dirty:true });
      this.schedule();
      return id;
    },

    // Write one file (device first; the server follows on the next sync).
    async write(draftId, name, body){
      const d = await getDraft(draftId); if(!d) throw new Error('no such draft');
      const cur = await getFile(draftId, name);
      if(cur && cur.body === body && !cur.dirty) return;            // nothing changed → nothing to send
      await putFile({ draftId, name, body, editedAt:stamp(), dirty:true });
      this.schedule();
    },
    read: async (draftId, name) => { const f = await getFile(draftId, name); return f ? f.body : null; },
    files: async draftId => (await draftFiles(draftId)).map(f => ({ name:f.name, body:f.body })),

    // Sync soon (after a burst of edits settles).
    schedule(){ clearTimeout(timer); timer = setTimeout(() => this.sync(), SYNC_DELAY); countPending().then(() => emit(false)); },

    // Pull then push. One at a time; a call while one runs waits for it and runs again.
    async sync(){
      clearTimeout(timer);
      if(running){ await running.catch(() => {}); }
      const u = uid();
      if(!u || !this.backend || !this.backend.draftsPull){ await countPending(); emit(false); return { ok:false, offline:!u }; }
      if(typeof navigator !== 'undefined' && navigator.onLine === false){ await countPending(); state.error = 'offline'; emit(false); return { ok:false, offline:true }; }
      state.syncing = true; emit(false);
      running = (async () => {
        let changed = false;
        try{
          changed = await pull(u);
          await push(u);
          state.error = null; state.lastSync = new Date().toISOString();
        }catch(e){ state.error = e.message || String(e); console.warn('[cloud-drafts] sync', state.error); }
        finally{ state.syncing = false; await countPending(); emit(changed); }
        return { ok:!state.error, changed };
      })();
      return running;
    },

    // For tests: forget everything on this device.
    async _wipe(){ const d = await db(); for(const s of ['drafts','files','meta']) await new Promise(r => { const tx = d.transaction(s,'readwrite'); tx.objectStore(s).clear(); tx.oncomplete = r; }); lastStamp = 0; }
  };

  window.CloudDrafts = CloudDrafts;

  // Wire-up: sync when the session resolves (auth.js fires 'akashic-auth'), when the
  // connection comes back, and before the tab goes to the background.
  window.addEventListener('akashic-auth', () => { if(window.AkashicAuth) CloudDrafts.backend = window.AkashicAuth; CloudDrafts.sync(); });
  window.addEventListener('online', () => CloudDrafts.sync());
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden' && state.pending) CloudDrafts.sync(); });
})();
