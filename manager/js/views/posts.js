import { h, clear, pill, plural, debounce, confirmDialog, toast } from '../ui.js';
import { editUrl, refreshStatus, reloadSite, announcePublished } from '../app.js';
import { collectPostDeletion } from '../core/publish.js';

export async function render(root, params, app) {
  const site = app.site;
  const posts = site.posts.slice();
  // order = the order on the Insights page (newest first); posts missing from it go last
  try {
    const { src } = await site.text('insights/index.html'); const { listingCards } = await import('../core/content.js'); const order = listingCards(src).map((c) => c.href);
    posts.sort((a, b) => { const i = order.indexOf(a.url), j = order.indexOf(b.url); return (i < 0 ? 9999 : i) - (j < 0 ? 9999 : j); });
  } catch { /* keep alphabetical */ }
  const q = h('input', { type: 'search', placeholder: 'Search posts…', 'aria-label': 'Search posts' });
  const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))].sort();
  const catSel = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'), ...cats.map((c) => h('option', { value: c }, c)));
  const tbody = h('tbody'); const count = h('span', { class: 'muted small' });
  const draw = () => {
    const term = q.value.trim().toLowerCase(); const c = catSel.value;
    const rows = posts.filter((p) => (!c || p.category === c) && (!term || p.title.toLowerCase().includes(term) || (p.excerpt || '').toLowerCase().includes(term)));
    clear(tbody);
    rows.forEach((p) => {
      const st = site.live.get(p.path);
      tbody.appendChild(h('tr', {},
        h('td', { style: { width: '72px' } }, p.image ? h('img', { src: site.displaySrc(p.image), alt: '', loading: 'lazy', style: { width: '64px', height: '48px', objectFit: 'cover', borderRadius: '3px', background: '#eef2f6' } }) : null),
        h('td', {}, h('a', { class: 't-title', href: editUrl(p.path) }, p.title), h('div', { class: 't-url' }, p.url)),
        h('td', {}, p.category ? pill(p.category) : ''),
        h('td', {}, st === 'live' ? pill('Live', 'ok') : st === 'pending' || st === 'missing' ? pill(st === 'missing' ? 'Not deployed yet' : 'Changed, not live yet', 'warn') : h('span', { class: 'muted small' }, st ? '' : 'Checking…')),
        h('td', {}, h('div', { class: 'actions', style: { justifyContent: 'flex-end' } }, h('a', { class: 'btn btn-sm', href: editUrl(p.path) }, 'Edit'), h('a', { class: 'btn btn-sm btn-quiet', href: site.liveUrl(p.url), target: '_blank', rel: 'noopener' }, 'View ↗'),
          h('button', { class: 'btn btn-sm btn-quiet', type: 'button', onClick: () => remove(p) }, 'Delete')))));
    });
    if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No posts match.')));
    count.textContent = plural(rows.length, 'post');
  };
  async function remove(p) {
    if (!(await confirmDialog(`Delete “${p.title}”? It is removed from the website, the Insights page and the sitemap. (The code history keeps a copy.)`, { confirmLabel: 'Delete post', danger: true }))) return;
    try { const { changes, expect } = await collectPostDeletion({ gh: app.gh, site, path: p.path }); await app.gh.commit({ message: `Delete post: ${p.title.slice(0, 70)}`, changes, expect }); await reloadSite(); announcePublished(null, { what: 'Post deleted' }); posts.splice(posts.indexOf(p), 1); draw(); }
    catch (e) { toast(e.message || String(e), 'err'); }
  }
  q.addEventListener('input', debounce(draw, 120)); catSel.addEventListener('change', draw);
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Blog posts'), h('p', { class: 'sub' }, 'The articles on the Insights page.')), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/posts/new' }, '+ New blog post'))));
  root.append(h('div', { class: 'toolbar' }, q, catSel, h('span', { class: 'grow' }), count));
  root.append(h('div', { class: 'card flush tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['', 'Post', 'Category', 'Status', ''].map((t) => h('th', {}, t)))), tbody)));
  draw(); const onLive = () => { if (document.body.contains(tbody)) draw(); else window.removeEventListener('ids:live-updated', onLive); }; window.addEventListener('ids:live-updated', onLive);
  void refreshStatus;
}
