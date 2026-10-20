// Turns an editing session into the exact set of file changes for ONE commit.
// Shared files that other people edit often (the Insights list, the sitemap) are re-read at publish time, so we never overwrite someone else's change.
import { readPost, addListingCard, updateListingCard, removeListingCard, sitemapAdd, sitemapRemove, urlForPath } from './content.js';

const LISTING = 'insights/index.html';
const SITEMAP = 'sitemap.xml';

async function fresh(gh, path) {
  const sha = await gh.fileSha(path);
  if (!sha) return { text: null, sha: null };
  return { text: await gh.fileText(path), sha };
}

/**
 * kind: 'page' | 'post'. For posts the card on the Insights page (and, for a new post, the sitemap) are updated in the same commit.
 */
export async function collectChanges({ gh, site, session, kind = 'page' }) {
  const changes = []; const expect = {}; const notes = [];
  changes.push({ path: session.path, text: session.src });
  expect[session.path] = session.isNew ? null : session.baseSha;
  if (kind === 'post') {
    const now = readPost(session.src); const was = session.isNew ? null : readPost(session.original);
    const href = urlForPath(session.path);
    const card = { href, category: now.category, title: now.title, excerpt: now.excerpt, image: now.heroImage };
    const cardChanged = session.isNew || ['title', 'category', 'excerpt', 'heroImage'].some((k) => now[k] !== was[k]);
    if (cardChanged) {
      const l = await fresh(gh, LISTING);
      if (l.text) {
        const next = session.isNew ? addListingCard(l.text, card) : updateListingCard(l.text, href, card);
        if (next !== l.text) { changes.push({ path: LISTING, text: next }); expect[LISTING] = l.sha; notes.push('Updated the card on the Insights page'); }
      }
    }
    if (session.isNew) {
      const sm = await fresh(gh, SITEMAP);
      if (sm.text) {
        const loc = site.siteBase() + href; const next = sitemapAdd(sm.text, loc);
        if (next !== sm.text) { changes.push({ path: SITEMAP, text: next }); expect[SITEMAP] = sm.sha; notes.push('Added the post to the sitemap'); }
      }
    }
  }
  return { changes, expect, notes };
}

/** Delete a post: its page, its card on the Insights page and its sitemap entry. */
export async function collectPostDeletion({ gh, site, path }) {
  const changes = [{ path, delete: true }]; const expect = {}; const notes = [];
  const e = site.byPath.get(path); expect[path] = e ? e.sha : null;
  const href = urlForPath(path);
  const l = await fresh(gh, LISTING);
  if (l.text) { const next = removeListingCard(l.text, href); if (next !== l.text) { changes.push({ path: LISTING, text: next }); expect[LISTING] = l.sha; notes.push('Removed from the Insights page'); } }
  const sm = await fresh(gh, SITEMAP);
  if (sm.text) { const next = sitemapRemove(sm.text, site.siteBase() + href); if (next !== sm.text) { changes.push({ path: SITEMAP, text: next }); expect[SITEMAP] = sm.sha; notes.push('Removed from the sitemap'); } }
  return { changes, expect, notes };
}

export function defaultMessage(session, kind, title) {
  const t = (title || session.path).replace(/\s+/g, ' ').slice(0, 70);
  if (session.isNew) return `Add post: ${t}`;
  return kind === 'post' ? `Update post: ${t}` : `Update page: ${t}`;
}

/* ------------------------------------------------------------- site-wide */
import { analyze, applyOp } from './htmlpatch.js';

/** The text edits made to site-wide blocks in a session: [{ tag, from, to }] (inner HTML before -> after). */
export function siteWideEdits(session) {
  const a0 = analyze(session.original, session.opts); const a1 = analyze(session.src, session.opts); const out = [];
  for (const b of a1.blocks) {
    if (b.lock) continue; const o = a0.blocks.find((x) => x.ord === b.ord);
    if (o && o.inner !== b.inner) out.push({ tag: b.tag, from: o.inner, to: b.inner });
  }
  return out;
}

/** Apply those edits to every matching site-wide block on another page. Returns { src, count }. */
export function replicateEdits(src, edits, opts) {
  let s = src; let count = 0;
  for (const e of edits) {
    for (let guard = 0; guard < 50; guard++) {           // re-analyse after each change; stop when nothing matches
      const a = analyze(s, { ...opts, invertLock: false });
      // A page whose layout differs slightly (so its band was not recognised as shared) still gets a long, word-for-word identical text block.
      const same = (b) => b.tag === e.tag && b.inner === e.from && b.inner !== e.to;
      const hit = a.blocks.find((b) => b.lock === 'site-wide' && same(b)) || a.blocks.find((b) => !b.lock && e.from.length >= 60 && same(b));
      if (!hit) break;
      s = applyOp(s, { type: 'setInner', ord: hit.ord, html: e.to, expect: e.from }, opts); count++;
    }
  }
  return { src: s, count };
}
