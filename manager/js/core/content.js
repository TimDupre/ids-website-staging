// Site-level content logic: page metadata, blog posts, the Insights listing, and the sitemap.
// Pure string-in / string-out, built on the source-preserving engine. Runs in the browser and in Node.
import { analyze, applyOp, applyOps, descendants, classesOf, attrOf, textOf, escAttr } from './htmlpatch.js';
import { sanitize } from './sanitize.js';

const SUFFIX = ' | iDiscovery Solutions';
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------- page facts */

export function pageFacts(src) {
  const a = analyze(src);
  const m = (k) => (a.meta[k] ? a.meta[k].value : '');
  const title = a.title ? a.title.text : '';
  return {
    title,
    description: m('description'),
    ogTitle: m('og:title'), ogDescription: m('og:description'), ogImage: m('og:image'), robots: m('robots'),
    canonical: a.meta.canonical ? a.meta.canonical.value : '',
  };
}

export function classify(p) {
  if (p === 'index.html') return { type: 'home', group: 'Pages' };
  if (/^insights\/index\.html$/.test(p)) return { type: 'listing', group: 'Pages' };
  if (/^insights\/[^/]+\/index\.html$/.test(p)) return { type: 'post', group: 'Insights' };
  if (/^case-studies\/index\.html$/.test(p)) return { type: 'listing', group: 'Pages' };
  if (/^case-studies\/[^/]+\/index\.html$/.test(p)) return { type: 'case-study', group: 'Case studies' };
  return { type: 'page', group: 'Pages' };
}

export function isPagePath(p) {
  return /(^|\/)index\.html$/.test(p) && !/^(admin|manager|assets|content)\//.test(p);
}
export const urlForPath = (p) => '/' + p.replace(/index\.html$/, '');
export const pathForSlug = (slug) => `insights/${slug}/index.html`;

/* ---------------------------------------------------------------- SEO */

/** Ops that apply the "Page settings" form to a page. Keeps og: tags in step with the page title/description when they matched. */
export function seoOps(src, next) {
  const facts = pageFacts(src); const ops = [];
  if (next.title !== undefined && next.title !== facts.title) {
    ops.push({ type: 'setTitle', text: next.title });
    if (facts.ogTitle && facts.ogTitle === facts.title) ops.push({ type: 'setMeta', key: 'og:title', value: next.title, by: 'property' });
  }
  if (next.description !== undefined && next.description !== facts.description) {
    ops.push({ type: 'setMeta', key: 'description', value: next.description, by: 'name' });
    if (facts.ogDescription === facts.description) ops.push({ type: 'setMeta', key: 'og:description', value: next.description, by: 'property' });
  }
  if (next.ogImage !== undefined && next.ogImage !== facts.ogImage) ops.push({ type: 'setMeta', key: 'og:image', value: next.ogImage, by: 'property' });
  if (next.robots !== undefined && next.robots !== facts.robots) {
    ops.push({ type: 'setMeta', key: 'robots', value: next.robots, by: 'name' });
  }
  return ops;
}

/* ---------------------------------------------------------- blog posts */

export function postParts(src) {
  const a = analyze(src);
  const find = (pred) => a.nodes.findIndex((el, i) => pred(el, i));
  const hero = find((el) => classesOf(el).includes('hero-pad'));
  const h1 = hero >= 0 ? descendants(a, hero).find((i) => a.nodes[i].tagName === 'h1') : -1;
  let category = -1, excerpt = -1, heroImg = -1;
  if (h1 >= 0) {
    const sibs = a.nodes[h1].parentNode.childNodes.filter((n) => n.tagName);
    const k = sibs.indexOf(a.nodes[h1]);
    const prev = sibs[k - 1]; const next = sibs[k + 1];
    if (prev && /border-left/.test(attrOf(prev, 'style') || '')) category = a.nodes.indexOf(prev);
    if (next && next.tagName === 'p') excerpt = a.nodes.indexOf(next);
  }
  if (hero >= 0) {
    const siblings = a.nodes[hero].parentNode.childNodes.filter((n) => n.tagName === 'img');
    if (siblings.length) heroImg = a.nodes.indexOf(siblings[0]);
  }
  const body = find((el) => classesOf(el).includes('post-body'));
  return { a, hero, h1, category, excerpt, heroImg, body };
}

export function readPost(src) {
  const { a, h1, category, excerpt, heroImg, body } = postParts(src);
  const text = (ord) => (ord >= 0 ? (a.blocks.find((b) => b.ord === ord) || {}).text || '' : '');
  const facts = pageFacts(src);
  return {
    title: text(h1), category: text(category), excerpt: text(excerpt),
    heroImage: heroImg >= 0 ? (a.images.find((i) => i.ord === heroImg) || {}).src || '' : '',
    hasBody: body >= 0, htmlTitle: facts.title, description: facts.description,
  };
}

const absolute = (siteUrl, p) => (/^https?:/.test(p) ? p : siteUrl.replace(/\/+$/, '') + p);

/** Ops that apply the post form (title/category/excerpt/image) to a post page, including <title> and og: tags. */
export function postFieldOps(src, f, { siteUrl = '' } = {}) {
  const parts = postParts(src); const cur = readPost(src); const ops = [];
  const inline = (v) => escText(v);
  if (f.title !== undefined && f.title !== cur.title && parts.h1 >= 0) ops.push({ type: 'setInner', ord: parts.h1, html: inline(f.title) });
  if (f.category !== undefined && f.category !== cur.category && parts.category >= 0) ops.push({ type: 'setInner', ord: parts.category, html: inline(f.category) });
  if (f.excerpt !== undefined && f.excerpt !== cur.excerpt && parts.excerpt >= 0) ops.push({ type: 'setInner', ord: parts.excerpt, html: inline(f.excerpt) });
  if (f.heroImage !== undefined && f.heroImage !== cur.heroImage && parts.heroImg >= 0) ops.push({ type: 'setAttr', ord: parts.heroImg, name: 'src', value: f.heroImage });
  // head tags follow the visible fields
  const facts = pageFacts(src);
  if (f.title !== undefined && f.title !== cur.title) {
    const htmlTitle = f.title.replace(/<[^>]+>/g, '') + SUFFIX;
    ops.push({ type: 'setTitle', text: htmlTitle });
    ops.push({ type: 'setMeta', key: 'og:title', value: htmlTitle, by: 'property' });
  }
  if (f.excerpt !== undefined && f.excerpt !== cur.excerpt) {
    const d = f.excerpt.replace(/<[^>]+>/g, '');
    ops.push({ type: 'setMeta', key: 'description', value: d, by: 'name' });
    ops.push({ type: 'setMeta', key: 'og:description', value: d, by: 'property' });
  }
  if (f.heroImage !== undefined && f.heroImage !== cur.heroImage) ops.push({ type: 'setMeta', key: 'og:image', value: absolute(siteUrl, f.heroImage), by: 'property' });
  void facts;
  return ops;
}

// ops are order-dependent for ords inside one document, so apply them one at a time (setInner on leaf blocks never renumbers)
export function applyPostFields(src, f, ctx) { return applyOps(src, postFieldOps(src, f, ctx)); }

/** Build a brand-new post page by cloning a template post and filling in the fields. */
export function newPostSource(templateSrc, f, { siteUrl, slug }) {
  const url = `${siteUrl.replace(/\/+$/, '')}/insights/${slug}/`;
  let s = templateSrc;
  // 1. visible fields + head
  s = applyPostFields(s, { title: f.title, category: f.category, excerpt: f.excerpt, heroImage: f.heroImage }, { siteUrl });
  s = applyOp(s, { type: 'setMeta', key: 'og:url', value: url, by: 'property' });
  const a = analyze(s);
  if (a.meta.canonical) {
    // canonical is a <link>; replace its href in place
    const link = a.head.childNodes.find((n) => n.tagName === 'link' && attrOf(n, 'rel') === 'canonical');
    const at = link.sourceCodeLocation.startTag.attrs.href;
    s = s.slice(0, at.startOffset) + `href="${escAttr(url)}"` + s.slice(at.endOffset);
  }
  // 2. body
  const { body } = postParts(s);
  if (body < 0) throw new Error('The template post has no article body to fill in.');
  s = applyOp(s, { type: 'setInner', ord: body, html: `\n${f.bodyHtml || '<p class="wp-block-paragraph">Start writing here.</p>'}\n` });
  return s;
}

/* ----------------------------------------------------- Insights listing */

export function listingCards(src) {
  const a = analyze(src);
  const out = [];
  a.nodes.forEach((el, ord) => {
    if (el.tagName === 'a' && attrOf(el, 'data-cat') !== undefined && /^\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)?$/.test(attrOf(el, 'href') || '')) {
      const kids = descendants(a, ord);
      const texts = a.blocks.filter((b) => kids.includes(b.ord));
      const img = a.images.find((i) => kids.includes(i.ord));
      out.push({ ord, href: attrOf(el, 'href'), cat: attrOf(el, 'data-cat'), category: (texts[0] || {}).text || '', title: (texts[1] || {}).text || '', excerpt: (texts[2] || {}).text || '', image: img ? img.src : '', blockOrds: texts.map((t) => t.ord), imgOrd: img ? img.ord : -1 });
    }
  });
  return out;
}

export function listingCategories(src) {
  const a = analyze(src); const cats = [];
  a.nodes.forEach((el) => { const f = attrOf(el, 'data-filter'); if (f && f !== 'All' && !cats.includes(f)) cats.push(f); });
  return cats;
}

const cardHtml = ({ href, category, title, excerpt, image }) =>
  `<a href="${escAttr(href)}" data-cat="${escAttr(category)}" style="display:block;box-shadow:0 0 0 1px #E6E9ED;background:#FFFFFF">
      <div style="height:180px;position:relative;overflow:hidden;background:#001D40"><img src="${escAttr(image)}" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" /></div>
      <div style="padding:26px 24px 28px">
        <div style="font-size:12px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:#DB6015;margin-bottom:12px">${escText(category)}</div>
        <div style="font-size:20px;font-weight:bold;letter-spacing:-.01em;line-height:1.2;color:#003764;margin-bottom:10px">${escText(title)}</div>
        <p style="font-size:15px;line-height:1.6;color:#595959;margin:0">${escText(excerpt)}</p>
      </div>
    </a>`;

/** Put a new card first in the grid (newest first). */
export function addListingCard(src, card) {
  const cards = listingCards(src);
  if (cards.some((c) => c.href === card.href)) throw new Error('That post is already in the Insights list.');
  if (!cards.length) throw new Error('Could not find the post grid on the Insights page.');
  return applyOp(src, { type: 'insertBefore', ord: cards[0].ord, html: cardHtml(card) });
}

export function updateListingCard(src, href, f) {
  const c = listingCards(src).find((x) => x.href === href);
  if (!c) return src;
  let s = src; const ops = [];
  if (f.category !== undefined && f.category !== c.category) { if (c.blockOrds[0] !== undefined) ops.push({ type: 'setInner', ord: c.blockOrds[0], html: escText(f.category) }); ops.push({ type: 'setAttr', ord: c.ord, name: 'data-cat', value: f.category }); }
  if (f.title !== undefined && f.title !== c.title && c.blockOrds[1] !== undefined) ops.push({ type: 'setInner', ord: c.blockOrds[1], html: escText(f.title) });
  if (f.excerpt !== undefined && f.excerpt !== c.excerpt && c.blockOrds[2] !== undefined) ops.push({ type: 'setInner', ord: c.blockOrds[2], html: escText(f.excerpt) });
  if (f.image !== undefined && f.image !== c.image && c.imgOrd >= 0) ops.push({ type: 'setAttr', ord: c.imgOrd, name: 'src', value: f.image });
  // setAttr on the card may shift ords of nothing (attributes only); setInner on leaf blocks never renumbers
  for (const op of ops) s = applyOp(s, op);
  return s;
}

export function removeListingCard(src, href) {
  const c = listingCards(src).find((x) => x.href === href);
  return c ? applyOp(src, { type: 'remove', ord: c.ord }) : src;
}

/* ------------------------------------------------------------- sitemap */

export function sitemapAdd(xml, loc) {
  if (xml.includes(`<loc>${loc}</loc>`)) return xml;
  const i = xml.lastIndexOf('</url>');
  const end = i + '</url>'.length;
  const lineStart = xml.lastIndexOf('\n', i) + 1; const indent = (xml.slice(lineStart).match(/^\s*/) || [''])[0];
  return xml.slice(0, end) + `\n${indent}<url><loc>${loc}</loc></url>` + xml.slice(end);
}
export function sitemapRemove(xml, loc) {
  const re = new RegExp(`[ \\t]*<url>\\s*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>[ \\t]*\\n?`);
  return xml.replace(re, '');
}

export function slugify(t) {
  return String(t).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
}
export function validSlug(s) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 80; }
export { textOf };
