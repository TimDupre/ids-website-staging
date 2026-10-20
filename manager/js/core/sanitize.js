// Cleans HTML coming out of the visual editor (or pasted in) before it is written into a page.
// Allow-list based: anything not explicitly allowed is unwrapped or dropped. Isomorphic (parse5, no DOM).
import { parseFragment, serialize } from '../../vendor/parse5.js';

const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'strong', 'i', 'em', 'u', 'br', 'span', 'sup', 'sub', 'small', 'mark', 'code', 'cite', 'time', 'q', 's', 'del', 'ins', 'wbr', 'kbd', 'bdi', 'bdo', 'dfn', 'data', 'samp', 'var']);
const FLOW_TAGS = new Set([...INLINE_TAGS, 'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'img', 'hr', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'use', 'title', 'desc', 'lineargradient', 'stop', 'clippath', 'mask']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'noscript', 'template', 'link', 'meta', 'base', 'frame', 'frameset', 'applet', 'canvas', 'audio', 'video', 'source']);
const RENAME = { b: 'strong', i: 'em' };

const GLOBAL_ATTRS = new Set(['class', 'style', 'id', 'title', 'lang', 'dir', 'aria-label', 'aria-hidden', 'aria-describedby', 'role']);
const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel', 'download', 'hreflang']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'srcset', 'sizes', 'decoding']),
  time: new Set(['datetime']), q: new Set(['cite']), data: new Set(['value']),
  td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan', 'scope']),
};
const SVG_ATTRS = new Set(['viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'xmlns', 'focusable', 'preserveaspectratio', 'opacity', 'fill-rule', 'clip-rule', 'offset', 'stop-color', 'href', 'xlink:href']);

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|\.\.?\/|\?)/i;
const isSafeUrl = (v) => SAFE_URL.test(v.trim()) || /^[a-z0-9][^:]*$/i.test(v.trim());   // relative like "page/" or "x.pdf"; anything with a scheme must be allowed

function cleanStyle(v) {
  if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import/i.test(v)) return null;
  if (/url\s*\(/i.test(v) && !/url\(\s*['"]?(\/|https?:)/i.test(v)) return null;
  return v;
}

function cleanAttrs(el, mode) {
  const tag = el.tagName.toLowerCase();
  const isSvg = SVG_TAGS.has(tag);
  const keep = [];
  for (const a of el.attrs || []) {
    const name = a.name.toLowerCase();
    if (name.startsWith('on')) continue;
    if (name.startsWith('data-ids-')) continue;                         // editor markers never reach the page
    let value = a.value;
    if (isSvg) { if (!SVG_ATTRS.has(name) && !GLOBAL_ATTRS.has(name)) continue; if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) continue; keep.push({ name: a.name, value }); continue; }
    if (mode.plain && (name === 'class' || name === 'style' || name === 'id' || name.startsWith('data-'))) continue;      // pasted content: keep words and links, drop foreign styling
    const allowed = GLOBAL_ATTRS.has(name) || name.startsWith('data-') || name.startsWith('aria-') || (TAG_ATTRS[tag] && TAG_ATTRS[tag].has(name));
    if (!allowed) continue;
    if (name === 'href' || name === 'src' || name === 'cite') { if (!isSafeUrl(value)) continue; }
    if (name === 'srcset' && /javascript:/i.test(value)) continue;
    if (name === 'style') { value = cleanStyle(value); if (value === null || !value.trim()) continue; }
    keep.push({ name: a.name, value });
  }
  if (tag === 'a') {
    const t = keep.find((x) => x.name === 'target');
    if (t && t.value === '_blank') {
      const r = keep.find((x) => x.name === 'rel');
      if (!r) keep.push({ name: 'rel', value: 'noopener' });
      else if (!/noopener/.test(r.value)) r.value += ' noopener';
    }
  }
  el.attrs = keep;
}

function walk(parent, mode, allowed) {
  const out = [];
  for (const node of parent.childNodes) {
    if (node.nodeName === '#text') { out.push(node); continue; }
    if (node.nodeName === '#comment') continue;
    if (!node.tagName) continue;
    let tag = node.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) continue;
    if (RENAME[tag]) { tag = RENAME[tag]; node.tagName = tag; node.nodeName = tag; }
    if (SVG_TAGS.has(tag) && (mode.svg || node.__inSvg)) {
      node.childNodes = walk(node, mode, allowed).map((c) => { c.__inSvg = true; return c; });
      node.__inSvg = true;
      cleanAttrs(node, mode); out.push(node); continue;
    }
    if (tag === 'font') { out.push(...walk(node, mode, allowed)); continue; }          // legacy tag from execCommand
    if (!allowed.has(tag)) {
      // unknown or not allowed here: keep the words, drop the wrapper
      const kids = walk(node, mode, allowed);
      if (mode.inline && /^(div|p|li|h[1-6]|blockquote|section|article|tr)$/.test(tag) && out.length && kids.length) out.push(brNode());
      out.push(...kids);
      continue;
    }
    node.childNodes = walk(node, mode, allowed);
    cleanAttrs(node, mode);
    // an attribute-less <span> is editor noise
    if (tag === 'span' && !(node.attrs && node.attrs.length)) { out.push(...node.childNodes); continue; }
    if (tag === 'img' && !(node.attrs || []).some((a) => a.name === 'src')) continue;
    out.push(node);
  }
  return out;
}

const brNode = () => ({ nodeName: 'br', tagName: 'br', attrs: [], namespaceURI: 'http://www.w3.org/1999/xhtml', childNodes: [] });

/**
 * mode 'inline' (default): for text blocks (p, h2, li, div-with-text ...) -> only inline markup survives.
 * mode 'flow': for article bodies -> paragraphs, headings, lists, quotes, figures, images survive.
 */
export function sanitize(html, { mode = 'inline', allowSvg = true, plain = false } = {}) {
  const frag = parseFragment(html);
  const allowed = mode === 'flow' ? FLOW_TAGS : INLINE_TAGS;
  frag.childNodes = walk(frag, { inline: mode === 'inline', svg: allowSvg && !plain, plain }, allowed);
  let out = serialize(frag);
  if (mode === 'inline') out = out.replace(/(<br\s*\/?>\s*)+$/i, '').replace(/^(\s*<br\s*\/?>)+/i, '');
  return out;
}

export function isSafeHref(v) { return isSafeUrl(String(v || '')); }
