// Source-preserving HTML editing engine.
//
// The site is ~110 hand-built HTML files. To edit them without re-formatting anything, every edit is applied as a
// splice on the ORIGINAL text using the exact character offsets reported by the HTML5 parser. Untouched bytes stay
// untouched, so commits show only what actually changed.
//
// Isomorphic: runs in the browser (manager UI) and in Node (tests).
import { parse } from '../../vendor/parse5.js';

export const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'del', 'ins']);
const OPAQUE_INLINE = new Set(['svg']);                                  // allowed inside a text block, never edited
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select', 'option', 'textarea', 'button', 'canvas', 'video', 'audio', 'object', 'embed', 'input', 'head', 'title', 'meta', 'link', 'base']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const attr = (el, name) => { const a = el.attrs && el.attrs.find((x) => x.name === name); return a ? a.value : undefined; };
const styleOf = (el) => (attr(el, 'style') || '').toLowerCase();

export function textOf(node) {
  if (node.nodeName === '#text') return node.value;
  if (!node.childNodes) return '';
  return node.childNodes.map(textOf).join('');
}
const isHiddenInline = (el) => attr(el, 'aria-hidden') === 'true';

function inlineSubtreeOk(el) {
  if (OPAQUE_INLINE.has(el.tagName)) return true;
  if (!INLINE.has(el.tagName)) return false;
  return el.childNodes.every((c) => !c.tagName || inlineSubtreeOk(c));
}

// A "text block" = an element whose children are only text and inline markup, with some visible text.
function isTextBlock(el) {
  if (SKIP.has(el.tagName)) return false;
  if (/display\s*:\s*(inline-)?(flex|grid)/.test(styleOf(el))) return false;   // layout rows: edit their children instead
  let hasText = false;
  for (const c of el.childNodes) {
    if (c.nodeName === '#text') { if (c.value.trim()) hasText = true; continue; }
    if (c.nodeName === '#comment') continue;
    if (!c.tagName) continue;
    if (!inlineSubtreeOk(c)) return false;
    if (!OPAQUE_INLINE.has(c.tagName) && !isHiddenInline(c) && textOf(c).trim()) hasText = true;
  }
  return hasText;
}

export const DEFAULT_SITEWIDE = {
  selectors: ['site-nav', 'mega'],               // class names that always mean "header/menu"
};

/** Stable fingerprint of a chunk of markup (whitespace-insensitive). Used to recognise blocks repeated on many pages. */
export function fingerprint(markup) {
  const t = markup.replace(/\s+/g, ' ').trim();
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 + c, 2654435761) >>> 0; }
  return h1.toString(36) + h2.toString(36) + t.length.toString(36);
}

/** body-level blocks of a page, as {ord-independent} fingerprints (used to learn which blocks are site-wide). */
export function bodyBlockFingerprints(src) {
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const html = doc.childNodes.find((n) => n.tagName === 'html');
  const body = html && html.childNodes.find((n) => n.tagName === 'body');
  if (!body) return [];
  return body.childNodes.filter((n) => n.tagName && n.sourceCodeLocation && n.tagName !== 'script' && n.tagName !== 'svg')
    .map((n) => fingerprint(src.slice(n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset)));
}

/** Given {pagePath: src} or fingerprint lists, return the Set of fingerprints that appear on enough pages to be site-wide. */
export function learnSharedBlocks(fingerprintLists, { minPages = 5, minShare = 0.08 } = {}) {
  const counts = new Map();
  for (const list of fingerprintLists) for (const f of new Set(list)) counts.set(f, (counts.get(f) || 0) + 1);
  const need = Math.max(minPages, Math.ceil(fingerprintLists.length * minShare));
  return new Set([...counts].filter(([, n]) => n >= need).map(([f]) => f));
}

function topLevelLock(el, cfg, src, shared) {
  const cls = (attr(el, 'class') || '').split(/\s+/);
  if (cfg.selectors.some((s) => cls.includes(s))) return 'site-wide';
  const id = attr(el, 'id') || '';
  if (/-menu$/.test(id) || /^cap-mega/.test(id)) return 'site-wide';
  const l = el.sourceCodeLocation;
  if (shared && shared.size && l && fingerprint(src.slice(l.startOffset, l.endOffset)) && shared.has(fingerprint(src.slice(l.startOffset, l.endOffset)))) return 'site-wide';
  return null;
}

/**
 * Parse a page and describe every element we care about.
 * ord = document-order index of elements (text blocks are leaves: their descendants get no ord, so
 * editing a block's inner markup never renumbers the rest of the page).
 */
export function analyze(src, opts = {}) {
  const cfg = { ...DEFAULT_SITEWIDE, ...(opts.siteWide || {}) };
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const html = doc.childNodes.find((n) => n.tagName === 'html');
  const head = html && html.childNodes.find((n) => n.tagName === 'head');
  const body = html && html.childNodes.find((n) => n.tagName === 'body');
  const nodes = [];            // ord -> element
  const lock = [];             // ord -> reason|null
  const kind = [];             // ord -> 'block' | 'image' | 'container' | 'other'
  const parentOrd = [];

  function visit(el, parent, inheritedLock) {
    const ord = nodes.length;
    nodes.push(el); parentOrd.push(parent);
    let myLock = inheritedLock;
    if (!myLock && parent !== -1 && nodes[parent] === body) {
      const shared = topLevelLock(el, cfg, src, opts.sharedBlocks);
      // site-wide editing mode flips the rule: the shared blocks are editable and everything page-specific is locked
      myLock = opts.invertLock ? (shared ? null : 'page-content') : shared;
    }
    if (!myLock && !opts.invertLock && attr(el, 'data-key') !== undefined && opts.homeKeysLocked !== false) myLock = 'home-content';
    lock.push(myLock || null);
    if (el.tagName === 'img') { kind.push('image'); return; }
    if (SKIP.has(el.tagName) && el.tagName !== 'head') { kind.push('other'); return; }
    if (el !== head && isTextBlock(el)) { kind.push('block'); return; }
    kind.push(el.tagName === 'head' ? 'head' : 'container');
    for (const c of el.childNodes) if (c.tagName) visit(c, ord, myLock);
  }
  if (html) visit(html, -1, null);
  // site-wide editing changes the very content that identifies a block as site-wide, so its lock map is frozen from the page as loaded
  if (opts.frozenLocks && opts.frozenLocks.length === lock.length) opts.frozenLocks.forEach((v, i) => { lock[i] = v; });

  const loc = (el) => el.sourceCodeLocation;
  const info = (ord) => {
    const el = nodes[ord]; const l = loc(el);
    if (!l || !l.startTag) return null;
    const hasEnd = !!l.endTag;
    return {
      tag: el.tagName,
      start: l.startOffset, end: l.endOffset,
      openEnd: l.startTag.endOffset,
      innerStart: l.startTag.endOffset,
      innerEnd: hasEnd ? l.endTag.startOffset : l.endOffset,
      hasEndTag: hasEnd,
      attrs: l.startTag.attrs || {},
    };
  };

  const blocks = []; const images = [];
  nodes.forEach((el, ord) => {
    if (kind[ord] === 'block' && info(ord)) {
      const i = info(ord);
      blocks.push({ ord, tag: el.tagName, lock: lock[ord], inner: src.slice(i.innerStart, i.innerEnd), text: textOf(el).replace(/\s+/g, ' ').trim() });
    } else if (kind[ord] === 'image' && info(ord)) {
      images.push({ ord, lock: lock[ord], src: attr(el, 'src') || '', alt: attr(el, 'alt') || '' });
    }
  });

  // <head> facts used by the SEO panel
  const meta = {};
  let title = null;
  if (head) {
    for (const el of head.childNodes) {
      if (!el.tagName) continue;
      if (el.tagName === 'title') {
        const l = loc(el); if (l && l.startTag) title = { text: textOf(el), start: l.startTag.endOffset, end: l.endTag ? l.endTag.startOffset : l.endOffset };
      } else if (el.tagName === 'meta') {
        const key = attr(el, 'name') || attr(el, 'property'); const l = loc(el);
        if (key && l) meta[key] = { value: attr(el, 'content') || '', el, start: l.startOffset, end: l.endOffset, by: attr(el, 'name') ? 'name' : 'property' };
      } else if (el.tagName === 'link' && attr(el, 'rel') === 'canonical') {
        meta.canonical = { value: attr(el, 'href') || '' };
      }
    }
  }
  return { src, doc, html, head, body, nodes, lock, kind, parentOrd, info, blocks, images, meta, title };
}

/* ------------------------------------------------------------------ preview */

function openTagNameEnd(src, start, tag) { return start + 1 + tag.length; }

/** Copy of the page with data-ids-n="ord" markers on every element that has a source position (for the iframe). */
export function buildPreview(src, a, { base } = {}) {
  const inserts = [];
  a.nodes.forEach((el, ord) => {
    const l = el.sourceCodeLocation; if (!l || !l.startTag) return;
    const cls = a.lock[ord] ? 'lock' : a.kind[ord];
    inserts.push([openTagNameEnd(src, l.startOffset, el.tagName), ` data-ids-n="${ord}" data-ids-k="${cls}"`]);
  });
  if (a.head && a.head.sourceCodeLocation && a.head.sourceCodeLocation.endTag) {
    inserts.push([a.head.sourceCodeLocation.endTag.startOffset, base ? `<base href="${escAttr(base)}">` : '']);
  }
  inserts.sort((x, y) => y[0] - x[0]);
  let out = src;
  for (const [pos, text] of inserts) out = out.slice(0, pos) + text + out.slice(pos);
  return out;
}

/* --------------------------------------------------------------------- ops */

export function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
const splice = (s, a, b, ins) => s.slice(0, a) + ins + s.slice(b);

function lineBounds(src, pos) {
  const ls = src.lastIndexOf('\n', pos - 1) + 1;
  return ls;
}

function removeRange(src, start, end) {
  // also drop the whole line when it would be left blank
  const ls = lineBounds(src, start);
  let le = src.indexOf('\n', end); if (le === -1) le = src.length;
  if (/^[ \t]*$/.test(src.slice(ls, start)) && /^[ \t]*$/.test(src.slice(end, le))) return splice(src, Math.max(0, ls - (ls > 0 ? 1 : 0)), le, '');
  return splice(src, start, end, '');
}

function elementSiblings(a, ord) {
  const p = a.nodes[ord].parentNode; if (!p || !p.childNodes) return [];
  return p.childNodes.filter((n) => n.tagName && n.sourceCodeLocation && n.sourceCodeLocation.startTag);
}

export function applyOp(src, op, opts) {
  const a = analyze(src, opts);
  const need = (ord) => { const i = a.info(ord); if (!i) throw new Error(`Element ${ord} has no source position`); return i; };
  switch (op.type) {
    case 'setInner': {
      const i = need(op.ord);
      if (op.expect !== undefined && src.slice(i.innerStart, i.innerEnd) !== op.expect) throw conflict('The text changed since this page was loaded.');
      if (VOID.has(i.tag)) throw new Error('Cannot set content of a void element');
      return splice(src, i.innerStart, i.innerEnd, op.html);
    }
    case 'setAttr': {
      const i = need(op.ord);
      const existing = i.attrs[op.name.toLowerCase()];
      const tagText = src.slice(i.start, i.openEnd);
      if (op.value === null || op.value === undefined) {
        if (!existing) return src;
        let s = existing.startOffset; while (s > i.start && /\s/.test(src[s - 1])) s--;
        return splice(src, s, existing.endOffset, '');
      }
      const text = `${op.name}="${escAttr(op.value)}"`;
      if (existing) return splice(src, existing.startOffset, existing.endOffset, text);
      const selfClose = tagText.endsWith('/>');
      let at = i.openEnd - (selfClose ? 2 : 1);
      while (at > i.start && /\s/.test(src[at - 1])) at--;            // keep before the trailing space of "<br />"
      return splice(src, at, at, ` ${text}`);
    }
    case 'remove': {
      const i = need(op.ord);
      return removeRange(src, i.start, i.end);
    }
    case 'duplicate': {
      const i = need(op.ord);
      const outer = src.slice(i.start, i.end);
      const ls = lineBounds(src, i.start); const lead = src.slice(ls, i.start);
      const ins = /^[ \t]*$/.test(lead) ? `\n${lead}${outer}` : ` ${outer}`;
      return splice(src, i.end, i.end, ins);
    }
    case 'insertAfter': {
      const i = need(op.ord);
      const ls = lineBounds(src, i.start); const lead = src.slice(ls, i.start);
      const ins = /^[ \t]*$/.test(lead) ? `\n${lead}${op.html}` : ` ${op.html}`;
      return splice(src, i.end, i.end, ins);
    }
    case 'insertBefore': {
      const i = need(op.ord);
      const ls = lineBounds(src, i.start); const lead = src.slice(ls, i.start);
      if (/^[ \t]*$/.test(lead)) return splice(src, ls, ls, `${lead}${op.html}\n`);
      return splice(src, i.start, i.start, `${op.html} `);
    }
    case 'insertInside': {                                           // append as last child
      const i = need(op.ord);
      return splice(src, i.innerEnd, i.innerEnd, op.html);
    }
    case 'move': {
      const sibs = elementSiblings(a, op.ord); const k = sibs.indexOf(a.nodes[op.ord]);
      const j = k + (op.dir < 0 ? -1 : 1);
      if (k < 0 || j < 0 || j >= sibs.length) return src;
      const [first, second] = k < j ? [sibs[k], sibs[j]] : [sibs[j], sibs[k]];
      const A = first.sourceCodeLocation, B = second.sourceCodeLocation;
      const aText = src.slice(A.startOffset, A.endOffset), bText = src.slice(B.startOffset, B.endOffset), gap = src.slice(A.endOffset, B.startOffset);
      return splice(src, A.startOffset, B.endOffset, bText + gap + aText);
    }
    case 'setTitle': {
      if (!a.title) return src;
      return splice(src, a.title.start, a.title.end, escText(op.text));
    }
    case 'setMeta': {
      const m = a.meta[op.key];
      const by = op.by || (m && m.by) || 'name';
      if (m && m.el) {
        const l = m.el.sourceCodeLocation; const at = l.startTag.attrs.content;
        if (at) return splice(src, at.startOffset, at.endOffset, `content="${escAttr(op.value)}"`);
        const selfClose = src.slice(l.startOffset, l.endOffset).endsWith('/>');
        const pos = l.endOffset - (selfClose ? 2 : 1);
        return splice(src, pos, pos, ` content="${escAttr(op.value)}"`);
      }
      const head = a.head && a.head.sourceCodeLocation && a.head.sourceCodeLocation.endTag;
      if (!head) throw new Error('This page has no <head> to add the tag to');
      const ls = lineBounds(src, head.startOffset); const lead = src.slice(ls, head.startOffset);
      const pad = /^[ \t]*$/.test(lead) ? lead + '    ' : '';
      return splice(src, head.startOffset, head.startOffset, `${pad}<meta ${by}="${escAttr(op.key)}" content="${escAttr(op.value)}">\n${/^[ \t]*$/.test(lead) ? lead : ''}`);
    }
    default: throw new Error(`Unknown operation: ${op.type}`);
  }
}

function escText(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function conflict(msg) { const e = new Error(msg); e.code = 'conflict'; return e; }

export function applyOps(src, ops, opts) { return ops.reduce((s, op) => applyOp(s, op, opts), src); }

/** Fingerprint used to tell whether two copies of a page are the same document (ignores whitespace-only changes). */
export function normalize(src) { return src.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim(); }

/** ords of every element inside `ord` (document order). */
export function descendants(a, ord) {
  const out = [];
  for (let i = ord + 1; i < a.nodes.length; i++) {
    let p = a.parentOrd[i]; let inside = false;
    while (p !== -1) { if (p === ord) { inside = true; break; } if (p < ord) break; p = a.parentOrd[p]; }
    if (inside) out.push(i); else if (a.parentOrd[i] < ord) break;
  }
  return out;
}

export function classesOf(el) { return (attr(el, 'class') || '').split(/\s+/).filter(Boolean); }
export function attrOf(el, name) { return attr(el, name); }
