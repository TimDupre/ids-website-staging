// The visual editor: the real page in a sandboxed frame, with its text, images and sections editable in place.
import { h, clear, modal, toast, confirmDialog, field, pill, ago, fmtDate, busy, debounce, plural } from '../ui.js';
import { app, go, announcePublished, reloadSite } from '../app.js';
import { EditSession } from '../core/session.js';
import { buildPreview, descendants } from '../core/htmlpatch.js';
import { sanitize, isSafeHref } from '../core/sanitize.js';
import { pageFacts, seoOps, classify, readPost, postFieldOps, postParts, listingCategories, urlForPath } from '../core/content.js';
import { collectChanges, collectPostDeletion, defaultMessage, siteWideEdits, replicateEdits } from '../core/publish.js';
import { pickImage } from './media.js';
import { GitHubError } from '../github.js';

const EDIT_CSS = `
html{scroll-behavior:auto!important}
[data-ids-k="block"]{outline:1px dashed transparent;outline-offset:2px;cursor:text;min-height:1em;transition:outline-color .12s}
[data-ids-k="block"]:hover{outline-color:rgba(219,96,21,.6)}
[data-ids-k="block"]:focus{outline:2px solid #DB6015;outline-offset:2px}
.ids-sel{outline:2px solid #DB6015!important;outline-offset:2px!important}
[data-ids-k="image"]{cursor:pointer}
[data-ids-k="image"]:hover{outline:2px dashed rgba(219,96,21,.75);outline-offset:-2px}
[data-ids-k="container"]:not(html):not(body):not(head):hover{box-shadow:inset 0 0 0 1px rgba(0,55,100,.18)}
[data-ids-k="lock"]{cursor:not-allowed}
.ids-locked-top::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(0,55,100,.06) 0 10px,transparent 10px 20px);pointer-events:none;z-index:9998}
.ids-locked-top::after{content:'__LOCKLABEL__';position:absolute;top:6px;left:6px;background:rgba(0,55,100,.9);color:#fff;font:600 11px/1.4 system-ui,sans-serif;padding:3px 9px;border-radius:3px;z-index:9999;pointer-events:none;opacity:0;transition:opacity .15s}
.ids-locked-top:hover::after{opacity:1}
.wow,.reveal,[data-reveal],[data-tf-animation]{visibility:visible!important;opacity:1!important;transform:none!important;animation:none!important}
`;

const LOCK_LABEL = { normal: 'Site-wide section \\2013  edit under \\201CSite-wide blocks\\201D', sitewide: 'Page content \\2013  edit it from the page itself' };
const BLOCKS = {
  paragraph: { label: 'Paragraph', html: '<p class="wp-block-paragraph">New paragraph</p>' },
  heading: { label: 'Heading', html: '<h3 class="wp-block-heading">New heading</h3>' },
  list: { label: 'Bulleted list', html: '<ul class="wp-block-list">\n<li>First item</li>\n<li>Second item</li>\n</ul>' },
  quote: { label: 'Quote', html: '<blockquote class="wp-block-quote"><p>A memorable sentence.</p></blockquote>' },
  image: { label: 'Image…', html: null },
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const editHref = (p) => `#/edit?path=${encodeURIComponent(p)}`;

export async function render(root, params) {
  const site = app.site, gh = app.gh;
  const isNewPost = params.get('new') === '1';
  const siteWide = params.get('mode') === 'sitewide';
  const path = isNewPost ? (app.draftPost && app.draftPost.path) : params.get('path');
  if (!path) throw new Error('No page was chosen. Go back to Pages and click one.');
  if (isNewPost && !app.draftPost) throw new Error('Your new-post draft was lost (the page was reloaded). Start again from New blog post.');
  const meta = site.page(path) || { title: path, ...classify(path), url: urlForPath(path) };
  const kind = !siteWide && classify(path).type === 'post' ? 'post' : 'page';
  const isHome = path === 'index.html';

  let src, sha = null;
  if (isNewPost) src = app.draftPost.src; else ({ src, sha } = await site.text(path));
  const session = new EditSession({ path, sha, src, opts: siteWide ? { ...site.analyzeOpts(), invertLock: true } : site.analyzeOpts(), isNew: isNewPost });
  const draftKey = siteWide ? 'ids_mgr_draft:sitewide-unused' : `ids_mgr_draft:${path}`;
  const state = { session, doc: null, sel: null, dirty: new Set(), device: 'desktop', panel: kind === 'post' ? 'post' : 'block', ready: false, listing: null, history: null };
  const initial = kind === 'post' ? readPost(src) : null;
  if (kind === 'post') { try { state.listing = (await site.text('insights/index.html')).src; } catch { state.listing = null; } }

  // resume autosaved edits
  try {
    const raw = localStorage.getItem(draftKey);
    if (raw) { const d = JSON.parse(raw); if (d.src && d.src !== src && (isNewPost || d.sha === sha)) await offerResume(d); else localStorage.removeItem(draftKey); }
  } catch { /* ignore storage problems */ }
  function offerResume(d) {
    return new Promise((resolve) => {
      modal({ title: 'Resume your unpublished edits?', body: h('p', {}, `You have unpublished edits to this page saved on this computer (${ago(new Date(d.t).toISOString())}). Resume them, or start again from the published version?`), onClose: () => resolve(),
        actions: [{ label: 'Start again', onClick: () => { localStorage.removeItem(draftKey); } }, { label: 'Resume my edits', primary: true, onClick: () => { session.replaceAll(d.src, 'Resumed unpublished edits'); } }] });
    });
  }

  /* ------------------------------------------------------------- layout */
  const ifr = h('iframe', { title: 'Page preview', sandbox: 'allow-same-origin', src: 'preview.html' });
  const canvas = h('div', { class: 'canvas' }, ifr);
  const btn = (label, title, onClick, extra = {}) => h('button', { type: 'button', title, 'aria-label': title, onMousedown: (e) => e.preventDefault(), onClick, ...extra }, label);
  const B = {
    bold: btn('B', 'Bold (Ctrl+B)', () => fmt('bold')), italic: btn(h('i', {}, 'I'), 'Italic (Ctrl+I)', () => fmt('italic')),
    link: btn('Link', 'Add or edit a link (Ctrl+K)', () => linkDialog()), unlink: btn('Unlink', 'Remove link', () => fmt('unlink')), clear: btn('Clear format', 'Remove bold/italic/links from the selection', () => fmt('removeFormat')),
    parent: btn('↑ Parent', 'Select the box around this block', () => selectParent()), dup: btn('Duplicate', 'Duplicate the selected block or section', () => structural({ type: 'duplicate' })),
    up: btn('↑', 'Move up', () => structural({ type: 'move', dir: -1 })), down: btn('↓', 'Move down', () => structural({ type: 'move', dir: 1 })), del: btn('Delete', 'Delete the selected block or section', () => deleteSelected()),
  };
  const addSel = h('select', { title: 'Add a block after the selection', 'aria-label': 'Add a block', onChange: (e) => { const v = e.target.value; e.target.value = ''; if (v) addBlock(v); } },
    h('option', { value: '' }, '＋ Add block…'), ...Object.entries(BLOCKS).map(([k, b]) => h('option', { value: k }, b.label)));
  const fmtbar = h('div', { class: 'fmtbar' }, B.bold, B.italic, B.link, B.unlink, B.clear, h('span', { class: 'sepv' }), B.parent, B.dup, B.up, B.down, B.del, kind === 'post' ? [h('span', { class: 'sepv' }), addSel] : null,
    h('span', { class: 'grow' }), h('span', { class: 'muted small', id: 'selinfo' }, 'Click any text to edit it'));
  const dirtyDot = h('span', { class: 'dot hidden', title: 'Unpublished changes' });
  const undoB = h('button', { class: 'btn btn-sm', type: 'button', onClick: () => undoRedo('undo') }, '↶ Undo'); const redoB = h('button', { class: 'btn btn-sm', type: 'button', onClick: () => undoRedo('redo') }, '↷ Redo');
  const dev = (name, label) => h('button', { class: `btn btn-sm ${name === 'desktop' ? '' : 'btn-quiet'}`, type: 'button', 'data-dev': name, onClick: () => setDevice(name) }, label);
  const publishB = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => (siteWide ? openPublishSiteWide() : openPublish()) }, siteWide ? 'Publish everywhere' : 'Publish');
  const discardB = h('button', { class: 'btn btn-sm btn-quiet', type: 'button', onClick: () => discard() }, 'Discard changes');
  const top = h('div', { class: 'ed-top' },
    h('a', { class: 'btn btn-sm btn-quiet', href: siteWide ? '#/sitewide' : kind === 'post' ? '#/posts' : '#/pages' }, '← Back'),
    h('span', { class: 'ttl', title: meta.title }, meta.title || path), pill(siteWide ? 'Site-wide blocks' : isNewPost ? 'New post' : kind === 'post' ? 'Blog post' : 'Page', siteWide ? 'info' : ''), dirtyDot,
    h('span', { class: 'grow' }), undoB, redoB, h('span', { class: 'sepv' }), dev('desktop', 'Desktop'), dev('tablet', 'Tablet'), dev('mobile', 'Mobile'), h('span', { class: 'sepv' }),
    isNewPost ? null : h('a', { class: 'btn btn-sm btn-quiet', href: site.liveUrl(urlForPath(path)), target: '_blank', rel: 'noopener' }, 'View live ↗'), discardB, publishB);
  const panelHost = h('div', { class: 'ed-pane' });
  const tabs = h('div', { class: 'tabs' });
  const side = h('aside', { class: 'ed-side' }, tabs, panelHost);
  root.append(h('div', { class: 'ed' }, top, h('div', { class: 'ed-main' }, fmtbar, canvas), side));

  /* ------------------------------------------------------------ helpers */
  const doc = () => ifr.contentDocument;
  const elOf = (ord) => doc().querySelector(`[data-ids-n="${ord}"]`);
  const ordOf = (el) => (el ? Number(el.getAttribute('data-ids-n')) : -1);
  const dirtyNow = () => session.dirty || state.dirty.size > 0;
  app.guard = () => (dirtyNow() ? 'You have unpublished changes on this page.' : null);
  function updateTop() {
    const d = dirtyNow(); dirtyDot.classList.toggle('hidden', !d); undoB.disabled = !session.undoStack.length && !state.dirty.size; redoB.disabled = !session.redoStack.length;
    discardB.hidden = isNewPost || !d; publishB.disabled = !app.user.canPush || !d;
    const sel = state.sel; const info = document.getElementById('selinfo');
    const can = sel && !sel.locked && !siteWide; const isBlock = sel && sel.kind === 'block';
    [B.bold, B.italic, B.link, B.unlink, B.clear].forEach((b) => { b.disabled = !isBlock; });
    [B.parent, B.dup, B.up, B.down, B.del].forEach((b) => { b.disabled = !can; });
    addSel.disabled = kind !== 'post';
    if (info) info.textContent = !sel ? 'Click any text to edit it' : sel.locked ? 'Site-wide section (locked)' : sel.kind === 'block' ? 'Text block selected' : sel.kind === 'image' ? 'Image selected' : 'Section selected';
  }
  const autosave = debounce(() => {
    if (siteWide) return;
    try { if (session.dirty) localStorage.setItem(draftKey, JSON.stringify({ sha: session.baseSha, src: session.src, t: Date.now(), isNew: session.isNew })); else localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, 1200);

  /** Move text typed in the frame into the page source. */
  function flush() {
    if (!state.dirty.size) return false; let any = false;
    for (const ord of [...state.dirty]) {
      const el = elOf(ord); if (!el) continue;
      const clone = el.cloneNode(true);
      [clone, ...clone.querySelectorAll('*')].forEach((n) => { n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); });
      const html = sanitize(clone.innerHTML, { mode: 'inline' });
      const a = session.analysis(); const i = a.info(ord); if (!i) continue;
      const cur = session.src.slice(i.innerStart, i.innerEnd);
      if (sanitize(cur, { mode: 'inline' }) === html) continue;
      session.apply({ type: 'setInner', ord, html, expect: cur }); any = true;
    }
    state.dirty.clear(); updateTop(); autosave(); return any;
  }

  /* ------------------------------------------------------------- canvas */
  function decorate(d) {
    const style = d.createElement('style'); style.id = 'ids-edit-css'; style.textContent = EDIT_CSS.replace('__LOCKLABEL__', siteWide ? LOCK_LABEL.sitewide : LOCK_LABEL.normal); d.head.appendChild(style);
    d.querySelectorAll('[data-ids-k="block"]').forEach((el) => {
      el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true');
      el.querySelectorAll('[aria-hidden="true"], svg').forEach((x) => x.setAttribute('contenteditable', 'false'));
    });
    d.querySelectorAll('[data-ids-k="lock"]').forEach((el) => {
      if (el.parentElement && el.parentElement.closest('[data-ids-k="lock"]')) return;
      el.classList.add('ids-locked-top'); if (d.defaultView.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    });
    d.querySelectorAll('img').forEach((img) => {
      img.loading = 'eager'; const s = img.getAttribute('src') || '';
      if (site.localAssets.has(s)) img.src = site.localAssets.get(s);
    });
    d.addEventListener('click', onClick, true); d.addEventListener('focusin', onFocusIn); d.addEventListener('input', onInput);
    d.addEventListener('keydown', onKeydown); d.addEventListener('paste', onPaste); d.addEventListener('selectionchange', onSelChange);
    d.addEventListener('dragstart', (e) => e.preventDefault()); d.addEventListener('drop', (e) => e.preventDefault());
    d.addEventListener('submit', (e) => e.preventDefault(), true);
  }
  function writeCanvas() {
    const d = doc(); const sc = d.documentElement ? d.documentElement.scrollTop : 0;
    const a = session.analysis();
    const html = buildPreview(session.src, a, { base: site.sameOrigin() ? null : site.siteBase() + '/' });
    d.open(); d.write(html); d.close();
    decorate(d); d.documentElement.scrollTop = sc; state.sel = null; renderPanel(); updateTop();
  }
  ifr.addEventListener('load', () => { if (!state.ready) { state.ready = true; writeCanvas(); setTimeout(fitFrame, 50); } });
  function fitFrame() { ifr.style.height = `${Math.max(600, canvas.clientHeight - 32)}px`; }
  window.addEventListener('resize', fitFrame);

  function setDevice(name) {
    state.device = name; canvas.classList.toggle('tablet', name === 'tablet'); canvas.classList.toggle('mobile', name === 'mobile');
    top.querySelectorAll('[data-dev]').forEach((b) => b.classList.toggle('btn-quiet', b.dataset.dev !== name));
  }

  /* ---------------------------------------------------------- selection */
  function select(ord, kind2) {
    const d = doc(); d.querySelectorAll('.ids-sel').forEach((x) => x.classList.remove('ids-sel'));
    const el = elOf(ord);
    if (!el) { state.sel = null; renderPanel(); updateTop(); return; }
    const locked = el.getAttribute('data-ids-k') === 'lock';
    if (!locked && kind2 !== 'block') el.classList.add('ids-sel');
    state.sel = { ord, kind: kind2, locked };
    renderPanel(); updateTop();
  }
  function pick(target) {
    const lockEl = target.closest('[data-ids-k="lock"]');
    if (lockEl) return select(ordOf(lockEl.closest('[data-ids-n]')), 'lock');
    const blk = target.closest('[data-ids-k="block"]'); if (blk) return select(ordOf(blk), 'block');
    const img = target.closest('img[data-ids-k="image"]'); if (img) return select(ordOf(img), 'image');
    let c = target.closest('[data-ids-k="container"]');
    while (c && ['HTML', 'BODY', 'HEAD'].includes(c.tagName)) c = null;
    if (c) return select(ordOf(c), 'container');
    state.sel = null; doc().querySelectorAll('.ids-sel').forEach((x) => x.classList.remove('ids-sel')); renderPanel(); updateTop();
  }
  function onClick(e) { const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); if (e.target.closest && e.target.closest('summary') && !e.target.closest('[data-ids-k="block"]')) e.preventDefault(); pick(e.target); }
  function onFocusIn(e) { const blk = e.target.closest && e.target.closest('[data-ids-k="block"]'); if (blk && !(state.sel && state.sel.ord === ordOf(blk))) select(ordOf(blk), 'block'); }
  function onInput(e) { const blk = e.target.closest && e.target.closest('[data-ids-k="block"]'); if (!blk) return; state.dirty.add(ordOf(blk)); updateTop(); autosave(); }
  function onSelChange() { const d = doc(); if (!d) return; try { B.bold.classList.toggle('on', d.queryCommandState('bold')); B.italic.classList.toggle('on', d.queryCommandState('italic')); } catch { /* ignore */ } }
  function selectParent() {
    const el = state.sel && elOf(state.sel.ord); if (!el) return;
    let p = el.parentElement; while (p && !(p.hasAttribute('data-ids-n') && p.getAttribute('data-ids-k') === 'container' && !['HTML', 'BODY', 'HEAD'].includes(p.tagName))) p = p.parentElement;
    if (!p) return toast('That is already the outermost section.');
    if (p.getAttribute('data-ids-k') === 'lock') return;
    select(ordOf(p), 'container'); p.scrollIntoView({ block: 'nearest' });
  }

  /* --------------------------------------------------------- formatting */
  function fmt(cmd) {
    const d = doc(); const blk = state.sel && state.sel.kind === 'block' && elOf(state.sel.ord); if (!blk) return;
    blk.focus({ preventScroll: true }); d.execCommand('styleWithCSS', false, false); d.execCommand(cmd, false, null);
    state.dirty.add(ordOf(blk)); updateTop(); autosave();
  }
  function linkDialog() {
    const d = doc(); const sel = d.getSelection(); const blk = state.sel && state.sel.kind === 'block' && elOf(state.sel.ord); if (!blk || !sel || !sel.rangeCount) return toast('Click into some text and select the words to link.');
    const range = sel.getRangeAt(0).cloneRange(); const anchor = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement).closest('a');
    if (range.collapsed && !anchor) return toast('Select the words you want to turn into a link first.');
    const url = h('input', { type: 'text', value: anchor ? anchor.getAttribute('href') || '' : '', placeholder: 'https://… or /about/', list: 'ids-pages' });
    const dl = h('datalist', { id: 'ids-pages' }, site.pages.map((p) => h('option', { value: p.url }, p.title)));
    const tab = h('input', { type: 'checkbox', checked: anchor ? anchor.getAttribute('target') === '_blank' : false });
    modal({ title: anchor ? 'Edit link' : 'Add link', body: h('div', {}, field('Web address', url, 'Start typing a page name’s address to link inside the site, or paste a full address.'), dl, h('label', { class: 'check' }, tab, h('span', {}, 'Open in a new tab'))),
      actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => {
        let v = url.value.trim(); if (!v) return false;
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) v = `mailto:${v}`; else if (/^www\./i.test(v)) v = `https://${v}`; else if (!/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(v)) v = `https://${v}`;
        if (!isSafeHref(v)) { toast('That kind of link is not allowed.', 'err'); return false; }
        blk.focus({ preventScroll: true }); sel.removeAllRanges(); sel.addRange(range);
        if (anchor) anchor.setAttribute('href', v); else d.execCommand('createLink', false, v);
        const now = sel.rangeCount ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
        blk.querySelectorAll('a[href]').forEach((a) => { if (a === anchor || a.getAttribute('href') === v) { if (tab.checked) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } else if (a === anchor || (now && a.contains(now))) { a.removeAttribute('target'); a.removeAttribute('rel'); } } });
        state.dirty.add(ordOf(blk)); updateTop(); autosave(); renderPanel();
      } }] });
  }
  function onPaste(e) {
    const blk = e.target.closest && e.target.closest('[data-ids-k="block"]'); if (!blk) return; e.preventDefault();
    const htmlData = e.clipboardData.getData('text/html'); const text = e.clipboardData.getData('text/plain');
    const out = htmlData ? sanitize(htmlData, { mode: 'inline', plain: true }) : esc(text).replace(/\r?\n/g, '<br>');
    doc().execCommand('insertHTML', false, out); state.dirty.add(ordOf(blk)); updateTop(); autosave();
  }
  function onKeydown(e) {
    const mod = e.metaKey || e.ctrlKey; const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); siteWide ? openPublishSiteWide() : openPublish(); return; }
    if (mod && key === 'k') { e.preventDefault(); linkDialog(); return; }
    if (e.key === 'Escape') { state.sel = null; doc().querySelectorAll('.ids-sel').forEach((x) => x.classList.remove('ids-sel')); renderPanel(); updateTop(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const blk = e.target.closest && e.target.closest('[data-ids-k="block"]'); if (!blk) return;
      e.preventDefault();
      if (['P', 'LI'].includes(blk.tagName)) splitBlock(blk); else doc().execCommand('insertLineBreak');
    }
  }
  function splitBlock(blk) {
    const d = doc(); const sel = d.getSelection(); if (!sel.rangeCount) return; const r = sel.getRangeAt(0); r.deleteContents();
    const tail = d.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEndAfter(blk.lastChild || blk);
    const wrap = d.createElement('div'); wrap.appendChild(tail.extractContents());
    const after = sanitize(wrap.innerHTML, { mode: 'inline' }); const ord = ordOf(blk);
    state.dirty.add(ord); flush();
    const i = session.analysis().info(ord); const open = session.src.slice(i.start, i.openEnd); const placeholder = !after.replace(/<br\s*\/?>/g, '').trim();
    const html = `${open}${placeholder ? (blk.tagName === 'LI' ? 'New item' : 'New paragraph') : after}</${i.tag}>`;
    session.apply({ type: 'insertAfter', ord, html }, 'Added a block'); writeCanvas();
    const nb = elOf(ord + 1); if (nb) { nb.focus(); const rg = doc().createRange(); rg.selectNodeContents(nb); if (!placeholder) rg.collapse(true); const s2 = doc().getSelection(); s2.removeAllRanges(); s2.addRange(rg); select(ord + 1, 'block'); }
  }

  /* --------------------------------------------------------- structure */
  function siblings(a, ord) { const p = a.nodes[ord].parentNode; return p.childNodes.filter((n) => n.tagName && n.sourceCodeLocation && n.sourceCodeLocation.startTag); }
  function structural(op0) {
    if (!state.sel || state.sel.locked) return; const ord = state.sel.ord; flush();
    const before = session.analysis(); const sibs = siblings(before, ord); const k = sibs.indexOf(before.nodes[ord]);
    const r = session.apply({ ...op0, ord }); if (!r.changed) { toast(op0.type === 'move' ? 'It cannot move any further.' : 'Nothing changed.'); return; }
    writeCanvas(); const after = session.analysis(); const s2 = siblings(after, ord); const target = op0.type === 'duplicate' ? s2[k + 1] : op0.type === 'move' ? s2[k + op0.dir] : null;
    if (target) { const o = after.nodes.indexOf(target); select(o, after.kind[o] === 'block' ? 'block' : after.kind[o] === 'image' ? 'image' : 'container'); const el = elOf(o); el && el.scrollIntoView({ block: 'nearest' }); }
  }
  async function deleteSelected() {
    if (!state.sel || state.sel.locked) return; const ord = state.sel.ord; flush();
    const a = session.analysis(); const inner = descendants(a, ord).length; const blocks = a.blocks.filter((b) => b.ord === ord || descendants(a, ord).includes(b.ord)).length;
    if (inner > 0 || blocks > 1) { if (!(await confirmDialog(`Delete this section and the ${plural(blocks, 'text block')} inside it? You can undo this until you publish.`, { confirmLabel: 'Delete', danger: true }))) return; }
    session.apply({ type: 'remove', ord }); writeCanvas();
  }
  async function addBlock(type) {
    flush(); const parts = postParts(session.src); if (parts.body < 0) return toast('This page has no article area to add to.', 'err');
    let html = BLOCKS[type].html;
    if (type === 'image') { const p = await pickImage(app, { title: 'Choose an image for the article' }); if (!p) return; html = `<figure class="wp-block-image"><img src="${escA(p)}" alt="" /></figure>`; }
    const a = session.analysis(); let ref = state.sel ? state.sel.ord : -1;
    while (ref >= 0 && a.parentOrd[ref] !== parts.body) ref = a.parentOrd[ref];
    const op = ref >= 0 ? { type: 'insertAfter', ord: ref, html } : { type: 'insertInside', ord: parts.body, html: `\n${html}\n` };
    session.apply(op, 'Added a block'); writeCanvas();
    const a2 = session.analysis(); const nxt = ref >= 0 ? a2.nodes.indexOf(siblings(a2, ref)[siblings(a2, ref).indexOf(a2.nodes[ref]) + 1]) : -1;
    if (nxt > -1) {
      const el = elOf(nxt); el && el.scrollIntoView({ block: 'center' }); select(nxt, a2.kind[nxt] === 'block' ? 'block' : 'container');
      if (el && a2.kind[nxt] === 'block') { const doc = el.ownerDocument; el.focus(); const r = doc.createRange(); r.selectNodeContents(el); const s = doc.defaultView.getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
  }
  function undoRedo(which) { flush(); if (which === 'undo' ? session.undo() : session.redo()) { writeCanvas(); autosave(); } }
  async function discard() {
    if (!(await confirmDialog('Throw away every unpublished change on this page?', { confirmLabel: 'Discard changes', danger: true }))) return;
    state.dirty.clear(); session.discard(); try { localStorage.removeItem(draftKey); } catch { /* ignore */ } writeCanvas();
  }

  /* -------------------------------------------------------------- panel */
  const TABS = siteWide ? [['block', 'Block']] : [['block', 'Block'], ['page', 'Page'], ...(kind === 'post' ? [['post', 'Post']] : []), ...(isNewPost ? [] : [['history', 'History']])];
  function renderTabs() {
    clear(tabs); TABS.forEach(([k, l]) => tabs.appendChild(h('button', { type: 'button', class: state.panel === k ? 'on' : '', onClick: () => { state.panel = k; renderPanel(); } }, l)));
  }
  function renderPanel() {
    renderTabs(); clear(panelHost);
    if (state.panel === 'block') panelHost.appendChild(blockPanel());
    else if (state.panel === 'page') panelHost.appendChild(pagePanel());
    else if (state.panel === 'post') panelHost.appendChild(postPanel());
    else historyPanel();
  }

  function blockPanel() {
    const sel = state.sel; const wrap = h('div');
    if (siteWide) wrap.append(h('div', { class: 'banner banner-info small' }, h('b', {}, 'Site-wide editing. '), 'Edit the menu, footer or call-to-action band here. When you publish, the same change is applied to every page that has the same block.'));
    if (isHome && !siteWide) wrap.append(h('div', { class: 'banner banner-info small' }, 'The home page’s main text comes from ', h('a', { href: '#/home' }, 'Home content'), ' (shown locked here). You can still edit its other text and images.'));
    if (!sel) { wrap.append(h('h2', {}, 'Edit this page'), h('ul', { class: 'small' }, h('li', {}, 'Click any text to type in it.'), h('li', {}, 'Click an image to replace it.'), h('li', {}, 'Click empty space around a block to select its section, then duplicate, move or delete it.'), h('li', {}, 'Hatched areas are site-wide and locked here.')), h('p', { class: 'small muted' }, 'Nothing is saved to the website until you press ', h('b', {}, 'Publish'), '.')); return wrap; }
    if (sel.locked && siteWide) { wrap.append(h('h2', {}, 'Page content'), h('p', {}, 'This part belongs to this one page, so it is locked while editing site-wide blocks. Edit it from the page itself.'), h('a', { class: 'btn', href: editHref(path) }, 'Edit this page →')); return wrap; }
    if (sel.locked) { wrap.append(h('h2', {}, 'Site-wide section'), h('p', {}, 'This part (menu, footer or call-to-action band) appears on every page, so it is locked here to keep the pages consistent.'), h('a', { class: 'btn', href: '#/sitewide' }, 'Edit site-wide blocks →')); return wrap; }
    const el = elOf(sel.ord); if (!el) return wrap;
    if (sel.kind === 'block') {
      wrap.append(h('h2', {}, 'Text block'), h('p', { class: 'small muted' }, `<${el.tagName.toLowerCase()}> · ${plural((el.textContent || '').trim().split(/\s+/).filter(Boolean).length, 'word')}`));
      const links = [...el.querySelectorAll('a[href]')];
      if (links.length) {
        wrap.append(h('h3', {}, 'Links in this block'));
        links.forEach((a) => {
          const u = h('input', { type: 'text', value: a.getAttribute('href') || '', 'aria-label': `Address for ${a.textContent}`, list: 'ids-pages2', onChange: (e) => { const v = e.target.value.trim(); if (!isSafeHref(v)) { toast('That kind of link is not allowed.', 'err'); e.target.value = a.getAttribute('href') || ''; return; } a.setAttribute('href', v); state.dirty.add(sel.ord); updateTop(); autosave(); } });
          const t = h('input', { type: 'checkbox', checked: a.getAttribute('target') === '_blank', onChange: (e) => { if (e.target.checked) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } else { a.removeAttribute('target'); a.removeAttribute('rel'); } state.dirty.add(sel.ord); updateTop(); autosave(); } });
          wrap.append(h('div', { class: 'linkrow' }, h('b', { class: 'small' }, (a.textContent || '(no text)').trim().slice(0, 40)), u, h('label', { class: 'check small' }, t, h('span', {}, 'Open in a new tab'))));
        });
        wrap.append(h('datalist', { id: 'ids-pages2' }, site.pages.map((p) => h('option', { value: p.url }, p.title))));
      }
      wrap.append(h('p', { class: 'small muted', style: { marginTop: '14px' } }, 'Press Enter for a new paragraph or list item; Shift+Enter for a line break.'));
    } else if (sel.kind === 'image') {
      const src = el.getAttribute('src') || '';
      const origSrc = (session.analysis().images.find((i) => i.ord === sel.ord) || {}).src || src;
      const alt = h('input', { type: 'text', value: el.getAttribute('alt') || '', onChange: (e) => { session.apply({ type: 'setAttr', ord: sel.ord, name: 'alt', value: e.target.value }); el.setAttribute('alt', e.target.value); updateTop(); autosave(); } });
      wrap.append(h('h2', {}, 'Image'), h('img', { class: 'imgprev', src: el.currentSrc || el.src, alt: '' }), h('p', { class: 'small muted mono', style: { wordBreak: 'break-all' } }, origSrc),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: async () => {
          const p = await pickImage(app, { title: 'Replace this image' }); if (!p) return; flush();
          const a = session.analysis(); const im = a.nodes[sel.ord];
          const hasSet = im.attrs.some((x) => x.name === 'srcset');
          session.apply({ type: 'setAttr', ord: sel.ord, name: 'src', value: p });
          if (hasSet) { session.apply({ type: 'setAttr', ord: sel.ord, name: 'srcset', value: null }); session.apply({ type: 'setAttr', ord: sel.ord, name: 'sizes', value: null }); }
          el.removeAttribute('srcset'); el.removeAttribute('sizes'); el.src = site.displaySrc(p); updateTop(); autosave(); renderPanel();
        } }, 'Change image…')),
        field('Image description (alt text)', alt, 'Describes the picture for screen readers and search engines. Leave empty for purely decorative images.'));
    } else {
      const a = session.analysis(); const kids = descendants(a, sel.ord); const nb = a.blocks.filter((b) => kids.includes(b.ord) && !b.lock).length; const ni = a.images.filter((i) => kids.includes(i.ord)).length;
      wrap.append(h('h2', {}, 'Section'), h('p', {}, `A box containing ${plural(nb, 'text block')} and ${plural(ni, 'image')}.`), h('p', { class: 'small muted' }, 'Use the toolbar to duplicate it (for example to add another card), move it, or delete it. Use “↑ Parent” to select the box around it.'));
    }
    return wrap;
  }

  function pagePanel() {
    flush(); const f = pageFacts(session.src); const wrap = h('div');
    const title = h('input', { type: 'text', value: f.title }); const desc = h('textarea', {}, f.description);
    const cT = h('span', { class: 'counter' }); const cD = h('span', { class: 'counter' });
    const count = () => { cT.textContent = `${title.value.length}/60`; cT.classList.toggle('bad', title.value.length > 65); cD.textContent = `${desc.value.length}/160`; cD.classList.toggle('bad', desc.value.length > 170); }; count();
    const robots = h('input', { type: 'checkbox', checked: /noindex/.test(f.robots) });
    const og = h('div', {}, h('img', { class: 'imgprev', src: f.ogImage ? site.displaySrc(f.ogImage.replace(/^https?:\/\/[^/]+/, '')) : '', alt: '', style: { display: f.ogImage ? '' : 'none' } }), h('div', { class: 'actions', style: { marginTop: '6px' } }, h('button', { class: 'btn btn-sm', type: 'button', onClick: async () => { const p = await pickImage(app, { title: 'Social sharing image' }); if (!p) return; apply({ ogImage: site.siteBase() + p }); } }, f.ogImage ? 'Change image…' : 'Choose image…')));
    const apply = (next) => {
      flush(); const ops = seoOps(session.src, next); if (!ops.length) return; let rr = false; ops.forEach((op) => { if (session.apply(op).rerender) rr = true; });
      updateTop(); autosave(); if (rr) { writeCanvas(); } renderPanel(); toast('Updated. Remember to Publish.', 'ok', 2500);
    };
    title.addEventListener('input', count); desc.addEventListener('input', count);
    title.addEventListener('change', () => apply({ title: title.value.trim() })); desc.addEventListener('change', () => apply({ description: desc.value.trim() }));
    robots.addEventListener('change', () => apply({ robots: robots.checked ? 'noindex, nofollow' : 'index, follow' }));
    wrap.append(h('h2', {}, 'Search & sharing'), h('p', { class: 'small muted' }, 'How this page appears in Google results and when shared on social media.'),
      field(h('span', {}, 'Page title ', cT), title, 'Shown in the browser tab and as the headline in search results. About 50–60 characters.'),
      field(h('span', {}, 'Search description ', cD), desc, 'The summary under the headline in search results. About 120–160 characters.'),
      field('Social sharing image', og, 'The picture shown when the page is shared.'),
      h('label', { class: 'check' }, robots, h('span', {}, 'Hide this page from search engines')),
      h('h3', {}, 'Address'), h('p', { class: 'small mono', style: { wordBreak: 'break-all' } }, site.liveUrl(urlForPath(path))), h('p', { class: 'small muted' }, 'A page’s address cannot be changed here, because other pages link to it.'));
    return wrap;
  }

  function postPanel() {
    flush(); const cur = readPost(session.src); const wrap = h('div');
    const cats = state.listing ? listingCategories(state.listing) : []; if (cur.category && !cats.includes(cur.category)) cats.unshift(cur.category);
    const title = h('input', { type: 'text', value: cur.title }); const cat = h('select', {}, cats.map((c) => h('option', { value: c, selected: c === cur.category }, c))); const exc = h('textarea', {}, cur.excerpt);
    const apply = (f) => {
      flush(); const ops = postFieldOps(session.src, f, { siteUrl: site.siteBase() }); if (!ops.length) return; let rr = false; ops.forEach((op) => { if (session.apply(op, f.title !== undefined ? 'Changed the post title' : f.excerpt !== undefined ? 'Changed the post summary' : f.category !== undefined ? 'Changed the category' : 'Changed the main image').rerender) rr = true; });
      updateTop(); autosave(); if (rr) writeCanvas(); else { const nb = session.analysis(); void nb; refreshBlocksFromSource(); } renderPanel();
    };
    title.addEventListener('change', () => apply({ title: title.value.trim() })); cat.addEventListener('change', () => apply({ category: cat.value })); exc.addEventListener('change', () => apply({ excerpt: exc.value.trim() }));
    wrap.append(h('h2', {}, 'Post details'), h('p', { class: 'small muted' }, 'These also update the card on the Insights page when you publish.'),
      field('Title', title), field('Category', cat, 'Posts are grouped by category on the Insights page.'), field('Summary', exc, 'One or two sentences. Shown at the top of the post, on the Insights page, and in search results.'),
      field('Main image', h('div', {}, cur.heroImage ? h('img', { class: 'imgprev', src: site.displaySrc(cur.heroImage), alt: '' }) : null, h('div', { class: 'actions', style: { marginTop: '6px' } }, h('button', { class: 'btn btn-sm', type: 'button', onClick: async () => { const p = await pickImage(app, { title: 'Main image for the post' }); if (p) apply({ heroImage: p }); } }, cur.heroImage ? 'Change image…' : 'Choose image…')))));
    if (!isNewPost) wrap.append(h('h3', {}, 'Danger zone'), h('button', { class: 'btn btn-danger btn-sm', type: 'button', onClick: () => deletePost() }, 'Delete this post…'));
    return wrap;
  }
  // after head/hero edits that do not renumber elements, reflect the new text in the frame without rebuilding it
  function refreshBlocksFromSource() { const a = session.analysis(); const d = doc(); a.blocks.forEach((b) => { const el = d.querySelector(`[data-ids-n="${b.ord}"]`); if (el && el !== d.activeElement && el.innerHTML !== b.inner) el.innerHTML = b.inner; }); a.images.forEach((im) => { const el = d.querySelector(`img[data-ids-n="${im.ord}"]`); if (el) { const want = site.displaySrc(im.src); if (el.getAttribute('src') !== im.src && el.src !== want) el.src = want; } }); }

  async function deletePost() {
    const ok = await confirmDialog(`Delete “${meta.title}”? It will be removed from the website, the Insights page and the sitemap. (It stays in the code history, so it can be recovered.)`, { confirmLabel: 'Delete post', danger: true }); if (!ok) return;
    try {
      const { changes, expect } = await collectPostDeletion({ gh, site, path });
      await gh.commit({ message: `Delete post: ${meta.title.slice(0, 70)}`, changes, expect });
      state.dirty.clear(); session.discard(); app.guard = null; try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      await reloadSite(); announcePublished(null, { what: 'Post deleted' }); go('#/posts');
    } catch (e) { toast(e.message || String(e), 'err'); }
  }

  async function historyPanel() {
    panelHost.appendChild(h('h2', {}, 'Earlier versions')); const list = h('div', {}, h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Loading…')); panelHost.appendChild(list);
    try {
      if (!state.history) state.history = await gh.history(path, { perPage: 20 });
      clear(list);
      if (!state.history.length) list.append(h('p', { class: 'muted' }, 'No earlier versions.'));
      state.history.forEach((c, i) => list.append(h('div', { class: 'hist-item' }, h('div', {}, h('b', {}, c.message.split('\n')[0].slice(0, 80))), h('div', { class: 'small muted' }, `${c.author} · ${fmtDate(c.date)}`),
        i === 0 ? pill('Current', 'ok') : h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '6px' }, onClick: async (e) => {
          const done = busy(e.currentTarget); try { flush(); const text = await gh.fileText(path, c.sha); session.replaceAll(text, `Restored the version from ${fmtDate(c.date)}`); writeCanvas(); autosave(); toast('Earlier version loaded. Review it, then Publish to make it live.'); } catch (er) { toast(er.message, 'err'); } finally { done(); }
        } }, 'Load this version'))));
    } catch (e) { clear(list); list.append(h('p', { class: 'muted' }, e.message)); }
  }

  /* ------------------------------------------------------------ publish */
  async function openPublish() {
    flush(); if (!dirtyNow()) return toast('There are no changes to publish.');
    if (!app.user.canPush) return toast('Your token is read-only. Create one with “Contents: Read and write”.', 'err');
    const pageTitle = (pageFacts(session.src).title || meta.title).replace(/\s*\|\s*iDiscovery Solutions\s*$/i, '');
    const msg = h('input', { type: 'text', value: defaultMessage(session, kind, pageTitle) });
    const list = session.summary();
    const body = h('div', {}, h('p', {}, isNewPost ? 'This adds a new blog post to the website.' : 'These changes will be saved to the website:'), h('ul', {}, (list.length ? list : ['Updated the page']).map((l) => h('li', {}, l))),
      kind === 'post' ? h('p', { class: 'small muted' }, isNewPost ? 'The post will also be added to the Insights page and the sitemap.' : 'If you changed the title, summary, category or image, the card on the Insights page is updated too.') : null,
      kind === 'post' && /Start writing here|>New heading<|>New paragraph<|>First item<|>A memorable sentence\./.test(session.src) ? h('div', { class: 'banner banner-warn small' }, 'This post still has placeholder text (such as “New heading” or “New paragraph”). Go back and replace it first, unless that is intended.') : null,
      field('Describe this change (optional)', msg, 'Saved in the page history so people can see what changed.'), h('div', { class: 'banner banner-info small' }, 'Publishing saves your change. To make it public, press Deploy afterwards (a button appears at the top of the screen).'));
    let m;
    m = modal({ title: 'Publish changes', body, actions: [{ label: 'Cancel' }, { label: 'Publish', primary: true, keepOpen: true, onClick: async (close, b) => {
      const done = busy(b, 'Publishing…');
      try {
        if (isNewPost && site.byPath.has(path)) throw new Error('A post with that address already exists. Go back and choose a different address.');
        const { changes, expect } = await collectChanges({ gh, site, session, kind });
        await gh.commit({ message: (msg.value || '').trim() || defaultMessage(session, kind, pageTitle), changes, expect });
        await reloadSite(); const e = site.byPath.get(path); session.markPublished(session.src, e ? e.sha : null); state.history = null;
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        if (isNewPost) { app.draftPost = null; app.guard = null; go(editHref(path)); } else { writeCanvas(); }
        close(); announcePublished(null, { what: isNewPost ? 'Post published' : 'Published' });
      } catch (e) { done(); if (e.code === 'file-changed') { close(); conflictDialog(e); } else toast(e instanceof GitHubError ? e.message : (e.message || String(e)), 'err'); }
      return false;
    } }] });
    void m;
  }
  async function openPublishSiteWide() {
    flush(); const edits = siteWideEdits(session); if (!edits.length) return toast('There are no site-wide changes to publish.');
    if (!app.user.canPush) return toast('Your token is read-only. Create one with “Contents: Read and write”.', 'err');
    const plain = (t) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
    const status = h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Checking every page…'); const msg = h('input', { type: 'text', value: 'Update site-wide content' });
    const list = h('ul', {}); let planned = [];
    const body = h('div', {}, h('ul', {}, edits.map((e) => h('li', {}, h('s', { class: 'muted' }, plain(e.from)), ' → ', h('b', {}, plain(e.to))))), status, list, field('Describe this change (optional)', msg));
    let pubBtn;
    const m = modal({ title: 'Publish site-wide change', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Publish everywhere', primary: true, keepOpen: true, disabled: true, onClick: async (close, b) => {
      const done = busy(b, 'Publishing…');
      try {
        await gh.commit({ message: (msg.value || '').trim() || 'Update site-wide content', changes: planned.map((p) => ({ path: p.path, text: p.text })), expect: Object.fromEntries(planned.map((p) => [p.path, p.sha])) });
        await reloadSite(); state.dirty.clear(); session.markPublished(session.src, session.baseSha); app.guard = null; close(); announcePublished(null, { what: `Updated ${plural(planned.length, 'page')}` }); go('#/sitewide');
      } catch (er) { done(); toast(er.code === 'file-changed' ? `“${er.path}” was changed by someone else while you were publishing. Reload and try again.` : (er.message || String(er)), 'err'); }
      return false;
    } }] });
    pubBtn = m.foot.querySelector('.btn-primary');
    try {
      const pages = site.pages; let i = 0; let places = 0; planned = [];
      const worker = async () => { while (i < pages.length) { const p = pages[i++]; const { src: t, sha: sh } = await site.text(p.path); const r = replicateEdits(t, edits, site.analyzeOpts()); if (r.count) { planned.push({ path: p.path, title: p.title, text: r.src, sha: sh, count: r.count }); places += r.count; } } };
      await Promise.all([worker(), worker(), worker(), worker()]);
      planned.sort((a, b) => a.path.localeCompare(b.path));
      clear(status); status.className = ''; status.append(h('b', {}, `This changes ${plural(places, 'place')} on ${plural(planned.length, 'page')}.`), h('span', { class: 'small muted' }, ' Pages whose copy of the block is slightly different (for example a highlighted menu item) are left alone.'));
      planned.slice(0, 8).forEach((p) => list.append(h('li', { class: 'small' }, p.title))); if (planned.length > 8) list.append(h('li', { class: 'small muted' }, `…and ${planned.length - 8} more`));
      pubBtn.disabled = planned.length === 0;
    } catch (er) { status.textContent = er.message || String(er); }
  }
  function conflictDialog(e) {
    modal({ title: 'Someone else changed this page', body: h('div', {}, h('p', {}, `“${e.path}” was saved by someone else while you were editing, so publishing now would overwrite their work.`), h('p', {}, 'Your edits are still on screen and saved on this computer. Load the latest version, then make your change again.')),
      actions: [{ label: 'Keep editing' }, { label: 'Load the latest version', primary: true, onClick: () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } app.guard = null; location.reload(); } }] });
  }

  /* --------------------------------------------------------------- start */
  const onKey = (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); siteWide ? openPublishSiteWide() : openPublish(); } };
  window.addEventListener('keydown', onKey);
  const stop = () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', fitFrame); window.removeEventListener('hashchange', stop); };
  window.addEventListener('hashchange', stop);
  renderTabs(); updateTop(); setTimeout(fitFrame, 0);
  void initial; void ago; void h;
}
