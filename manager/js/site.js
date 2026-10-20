// The site index: every page in the repository, with titles/categories read from the HTML,
// which blocks are site-wide, and whether each page is live yet.
import { analyze, bodyBlockFingerprints, learnSharedBlocks, fingerprint, normalize } from './core/htmlpatch.js';
import { classify, isPagePath, pageFacts, readPost, urlForPath } from './core/content.js';
import { metaCache } from './store.js';

const IMAGE_RE = /\.(jpe?g|png|gif|webp|svg|avif)$/i;
export const isImagePath = (p) => IMAGE_RE.test(p);

async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const item = items[i++]; await worker(item); } }));
}

export class Site {
  constructor(cfg, gh) {
    this.cfg = cfg; this.gh = gh;
    this.head = null; this.entries = []; this.byPath = new Map();
    this.pages = []; this.shared = new Set(); this.live = new Map(); this.localAssets = new Map(); this.textCache = new Map();
  }

  /** Read the repository tree and (re)build the page list. Only files not seen before are downloaded. */
  async load(onProgress = () => {}) {
    this.head = await this.gh.head();
    const t = await this.gh.tree(this.head.treeSha);
    if (t.truncated) throw new Error('The repository is too large to list in one request.');
    this.entries = t.entries; this.byPath = new Map(t.entries.map((e) => [e.path, e]));
    const pageEntries = t.entries.filter((e) => isPagePath(e.path)).sort((a, b) => a.path.localeCompare(b.path));
    const todo = pageEntries.filter((e) => !metaCache.get(e.sha));
    let done = 0; onProgress(0, todo.length);
    await pool(todo, 6, async (e) => {
      try {
        const src = await this.gh.blobText(e.sha); this.textCache.set(e.path, { sha: e.sha, src });
        const f = pageFacts(src); const kind = classify(e.path);
        const m = { title: f.title, description: f.description, ogImage: f.ogImage, robots: f.robots, fps: bodyBlockFingerprints(src), h: fingerprint(normalize(src)) };
        if (kind.type === 'post') { const p = readPost(src); Object.assign(m, { category: p.category, excerpt: p.excerpt, image: p.heroImage }); }
        metaCache.set(e.sha, m);
      } catch (err) { metaCache.set(e.sha, { title: '(could not read)', error: String(err), fps: [], h: '' }); }
      onProgress(++done, todo.length);
    });
    metaCache.prune(new Set(pageEntries.map((e) => e.sha))); metaCache.save();
    this.pages = pageEntries.map((e) => { const m = metaCache.get(e.sha) || {}; const k = classify(e.path); return { path: e.path, sha: e.sha, url: urlForPath(e.path), ...k, ...m, title: (m.title || '').replace(/\s*\|\s*iDiscovery Solutions\s*$/i, '') || e.path }; });
    this.shared = learnSharedBlocks(this.pages.map((p) => p.fps || []));
    return this;
  }

  page(path) { return this.pages.find((p) => p.path === path); }
  get posts() { return this.pages.filter((p) => p.type === 'post'); }
  siteBase() { return this.cfg.siteUrl.replace(/\/+$/, ''); }
  siteOrigin() { try { return new URL(this.cfg.siteUrl).origin; } catch { return location.origin; } }
  sameOrigin() { return this.siteOrigin() === location.origin; }
  liveUrl(path) { return this.siteBase() + (path.startsWith('/') ? path : '/' + path); }

  /** Text of a repository file at the current head (cached by blob sha). */
  async text(path) {
    const e = this.byPath.get(path); if (!e) throw new Error(`"${path}" is not in the repository.`);
    const c = this.textCache.get(path); if (c && c.sha === e.sha) return { src: c.src, sha: e.sha };
    const src = await this.gh.blobText(e.sha); this.textCache.set(path, { sha: e.sha, src });
    return { src, sha: e.sha };
  }

  analyzeOpts() { return { sharedBlocks: this.shared }; }

  /** Compare each page against what is actually deployed (bypassing the CDN with a cache-busting query). */
  async checkLive(onUpdate = () => {}, only) {
    const list = only ? this.pages.filter((p) => only.includes(p.path)) : this.pages;
    await pool(list, 4, async (p) => {
      let status = 'unknown';
      try {
        const r = await fetch(`${this.siteBase()}${p.url}?_=${Date.now()}`, { cache: 'no-store' });
        if (r.status === 404) status = 'missing';
        else if (r.ok) { const t = await r.text(); status = fingerprint(normalize(t)) === p.h ? 'live' : 'pending'; }
      } catch { status = 'unknown'; }
      this.live.set(p.path, status); onUpdate(p.path, status);
    });
    // The home page words live in a data file, so a change there also needs a deploy even though no page's HTML changed.
    const home = 'content/home.json';
    if (!only && this.byPath.has(home)) {
      let status = 'unknown';
      try {
        const [{ src: repoText }, r] = await Promise.all([this.text(home), fetch(`${this.siteBase()}/${home}?_=${Date.now()}`, { cache: 'no-store' })]);
        if (r.ok) { const t = await r.text(); status = fingerprint(normalize(t)) === fingerprint(normalize(repoText)) ? 'live' : 'pending'; }
      } catch { status = 'unknown'; }
      this.live.set(home, status);
    }
  }
  pendingCount() { let n = 0; for (const s of this.live.values()) if (s === 'pending' || s === 'missing') n++; return n; }

  /** After a successful commit: refresh head/tree so new shas and new pages show up. */
  async afterCommit(onProgress) { await this.load(onProgress); }

  media() { return this.entries.filter((e) => /^assets\//.test(e.path) && isImagePath(e.path)).map((e) => ({ path: e.path, sha: e.sha, size: e.size, name: e.path.split('/').pop(), folder: e.path.split('/').slice(0, -1).join('/') })); }
  /** URL to show an image in the manager (uploaded-but-not-deployed images use a local blob URL). */
  displaySrc(path) {
    if (this.localAssets.has(path)) return this.localAssets.get(path);
    if (/^https?:/.test(path)) return path;
    return this.siteBase() + (path.startsWith('/') ? path : '/' + path);
  }
}

export { analyze };
