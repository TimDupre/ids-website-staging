// Builds the blog's RSS feed (/feed/) from the post pages, so the feed never depends on the old WordPress site.
// Runs on every deploy (Sevalla "build command": node tools/build-feed.mjs) and can be run by hand from the site folder.
// It only reads insights/<post>/index.html and content/seo.json, and writes feed/index.html. If anything goes wrong it
// leaves the site as it was and still exits cleanly, so a feed problem can never block a deploy.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FULL_TEXT_FOR = 30;                       // newest posts carry their whole text; older ones carry the summary

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return Object.prototype.hasOwnProperty.call(entities, e.toLowerCase()) ? entities[e.toLowerCase()] : m;
});
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const rfc822 = (d) => new Date(d).toUTCString();

function innerOfDiv(html, marker) {                // inner HTML of the first <div …marker…>, matching nested divs
  const start = html.indexOf(marker); if (start < 0) return '';
  const open = html.indexOf('>', start) + 1; let depth = 1; const re = /<(\/?)div\b[^>]*>/gi; re.lastIndex = open; let m;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) return html.slice(open, m.index); }
  return html.slice(open);
}

function main() {
  const settings = JSON.parse(read('content/seo.json')); const site = String(settings.siteUrl || '').replace(/\/+$/, '');
  if (!site) throw new Error('content/seo.json has no siteUrl');
  const abs = (u) => (/^(https?:|mailto:|tel:|#|data:)/i.test(u) ? u : u.startsWith('//') ? 'https:' + u : site + (u.startsWith('/') ? '' : '/') + u);
  const dirs = fs.readdirSync(path.join(ROOT, 'insights'), { withFileTypes: true }).filter((d) => d.isDirectory());
  const items = [];
  for (const d of dirs) {
    const file = path.join('insights', d.name, 'index.html'); if (!fs.existsSync(path.join(ROOT, file))) continue;
    const html = read(file); let art = null;
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { const j = JSON.parse(m[1]); const n = (j['@graph'] || [j]).find((x) => x && x['@type'] === 'Article'); if (n) { art = n; break; } } catch { /* skip */ }
    }
    if (!art || !art.datePublished) continue;
    if (/<meta name="robots" content="[^"]*noindex/i.test(html) && settings.indexing === 'open') continue;
    const title = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, art.headline])[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() || art.headline;
    const desc = decode((html.match(/<meta name="description" content="([^"]*)"/i) || [, art.description || ''])[1]).trim();
    const img = (html.match(/<meta property="og:image" content="([^"]*)"/i) || [, ''])[1];
    const body = innerOfDiv(html, 'class="post-body"');
    items.push({ slug: d.name, link: `${site}/insights/${d.name}/`, title, desc, img, body, date: art.datePublished, mod: art.dateModified || art.datePublished, cat: art.articleSection || '', author: (art.author && art.author.name) || settings.siteName || '' });
  }
  if (!items.length) throw new Error('no posts found');
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  const absolutize = (h) => h.replace(/\b(href|src)="([^"]*)"/gi, (m, a, u) => `${a}="${abs(u)}"`).replace(/\sdata-[a-z-]+="[^"]*"/gi, '');
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">');
  out.push('<channel>');
  out.push(`<title>${esc(settings.siteName || 'Insights')} Insights</title>`);
  out.push(`<atom:link href="${site}/feed/" rel="self" type="application/rss+xml" />`);
  out.push(`<link>${site}/insights/</link>`);
  out.push(`<description>${esc(`Articles, guides and podcast episodes from ${settings.siteName || 'us'}: ${settings.tagline || ''}`.trim())}</description>`);
  out.push(`<language>${esc(settings.language || 'en-US')}</language>`);
  out.push(`<lastBuildDate>${rfc822(items[0].mod || items[0].date)}</lastBuildDate>`);
  out.push('<generator>build-feed.mjs</generator>');
  items.forEach((it, i) => {
    out.push('<item>');
    out.push(`<title>${esc(it.title)}</title>`);
    out.push(`<link>${it.link}</link>`);
    out.push(`<guid isPermaLink="true">${it.link}</guid>`);
    out.push(`<pubDate>${rfc822(it.date)}</pubDate>`);
    if (it.author) out.push(`<dc:creator>${cdata(it.author)}</dc:creator>`);
    if (it.cat) out.push(`<category>${cdata(decode(it.cat))}</category>`);
    out.push(`<description>${cdata(it.desc)}</description>`);
    if (it.img) out.push(`<media:content url="${esc(it.img)}" medium="image" />`);
    if (i < FULL_TEXT_FOR && it.body) out.push(`<content:encoded>${cdata(absolutize(it.body))}</content:encoded>`);
    out.push('</item>');
  });
  out.push('</channel>', '</rss>', '');
  fs.mkdirSync(path.join(ROOT, 'feed'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'feed', 'index.html'), out.join('\n'));
  console.log(`feed: ${items.length} posts, newest ${items[0].link}`);
}

try { main(); } catch (e) { console.error('feed not rebuilt:', e && e.message ? e.message : e); }
