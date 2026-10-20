// Browser storage: the access token (session by default, device-wide only if asked) and a small metadata cache.
const TOKEN_KEY = 'ids_mgr_token';
const META_KEY = 'ids_mgr_meta_v1';
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export const tokenStore = {
  get() { return safe(() => sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '', ''); },
  remembered() { return safe(() => !!localStorage.getItem(TOKEN_KEY), false); },
  set(token, remember) {
    safe(() => { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); });
    safe(() => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token));
  },
  clear() { safe(() => { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); }); },
};

// Page metadata keyed by the file's git blob sha: a changed file has a new sha, so entries never go stale.
let memo = null;
export const metaCache = {
  load() { if (!memo) memo = safe(() => JSON.parse(localStorage.getItem(META_KEY) || '{}'), {}); return memo; },
  get(sha) { return this.load()[sha]; },
  set(sha, value) { this.load()[sha] = value; },
  prune(keep) { const m = this.load(); for (const k of Object.keys(m)) if (!keep.has(k)) delete m[k]; },
  clear() { memo = {}; safe(() => localStorage.removeItem(META_KEY)); },
  save() { safe(() => localStorage.setItem(META_KEY, JSON.stringify(memo || {}))); },
};
