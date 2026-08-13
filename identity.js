/* ══ AKASHIC IDENTITY ═══════════════════════════════════════════════════════
 * Every visitor carries a persistent ID, kept no matter which path they take
 * (Explorer / Architect). Two tiers (Jed 2026-08-12, "handle now, username later"):
 *   1. anonymous  → a generated HANDLE (e.g. "wicked-jumping-llama"), minted once
 *      on first contact and stored in localStorage. Privacy-first: never derived
 *      from email (an email in a visible "Welcome back" would leak PII).
 *   2. signed-in  → a chosen USERNAME (Jed = "AbundantMind") OVERRIDES the handle.
 *      The durable username field folds into the held db/002 migration; until then
 *      auth.js seeds known accounts into the localStorage override below.
 *
 * Same-origin: the landing page and the game share one localStorage, so the ID
 * minted in the game is the one the landing greets. Classic script — exposes a
 * single global `AkashicID`. Keep this the ONE source of the word lists + keys.
 * ════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // localStorage keys (shared across landing + game, same origin)
  var K_HANDLE   = 'akashicswaps-handle';   // generated, minted once
  var K_USERNAME = 'akashicswaps-username';  // signed-in override (seeded by auth.js for now)

  // Word banks — adjective · action · animal. ~24³ ≈ 13k combos; grow the lists
  // as the population grows (collisions are cosmetic pre-server, dedup is db/002's job).
  var ADJ = ['wicked','abundant','clever','cosmic','golden','humble','curious','fearless',
             'radiant','nimble','ancient','electric','velvet','lucky','wandering','mighty',
             'silent','crimson','emerald','jolly','stellar','feral','gentle','bold'];
  var ACT = ['jumping','soaring','dreaming','dancing','roaring','gliding','plotting','grinning',
             'sprinting','brooding','humming','prowling','tumbling','beaming','drifting','scheming',
             'weaving','vaulting','musing','strolling','charging','napping','swaggering','pondering'];
  var ANI = ['llama','unicorn','otter','falcon','panther','gecko','walrus','magpie',
             'badger','dolphin','ibex','heron','lemur','marmot','octopus','raven',
             'bison','koala','narwhal','pangolin','quokka','tapir','wombat','yak'];

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  // Generate a fresh kebab-case handle, e.g. "wicked-jumping-llama".
  function mint() { return pick(ADJ) + '-' + pick(ACT) + '-' + pick(ANI); }

  function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // Ensure a handle exists (mint on first contact), and return it.
  function ensure() {
    var h = read(K_HANDLE);
    if (!h) { h = mint(); write(K_HANDLE, h); }
    return h;
  }

  // Title-case a kebab handle for display: "wicked-jumping-llama" → "Wicked Jumping Llama".
  // A username is shown verbatim (it's already how the person spelled it, e.g. "AbundantMind").
  function pretty(name) {
    if (!name) return '';
    if (name.indexOf('-') === -1) return name;                 // a username — leave as-is
    return name.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // The display name to greet with: signed-in username wins, else the generated
  // handle (minting one if somehow absent). Returns a display-ready string.
  function name() {
    var u = read(K_USERNAME);
    if (u) return pretty(u);
    return pretty(ensure());
  }

  // Set / clear the signed-in username override (called by auth.js).
  function setUsername(u) { if (u) write(K_USERNAME, u); }
  function clearUsername() { try { localStorage.removeItem(K_USERNAME); } catch (e) {} }

  root.AkashicID = {
    ensure: ensure,        // mint-if-absent, returns raw handle
    name: name,            // display-ready name to greet with (username || handle)
    rawHandle: function () { return read(K_HANDLE); },
    username: function () { return read(K_USERNAME); },
    setUsername: setUsername,
    clearUsername: clearUsername,
    _mint: mint            // exposed for tests
  };
})(window);
