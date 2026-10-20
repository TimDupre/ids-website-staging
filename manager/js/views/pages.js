import { h, clear, pill, ago, plural, debounce } from '../ui.js';
import { editUrl, refreshStatus } from '../app.js';

const TYPE_LABEL = { home: 'Home', page: 'Page', listing: 'List page', 'case-study': 'Case study', post: 'Blog post' };

export async function render(root, params, app) {
  const site = app.site;
  const q = h('input', { type: 'search', placeholder: 'Search pages by title or address…', 'aria-label': 'Search pages' });
  const type = h('select', { 'aria-label': 'Filter by type' }, [['all', 'All pages'], ['page', 'Pages'], ['case-study', 'Case studies'], ['post', 'Blog posts'], ['pending', 'Changed, not live yet']].map(([v, l]) => h('option', { value: v, selected: v === (params.get('show') || 'all') }, l)));
  const tbody = h('tbody'); const count = h('span', { class: 'muted small' });
  const histDates = new Map();

  const rowFor = (p) => {
    const st = site.live.get(p.path);
    const live = st === 'live' ? pill('Live', 'ok') : st === 'pending' ? pill('Changed, not live yet', 'warn') : st === 'missing' ? pill('Not deployed yet', 'warn') : h('span', { class: 'muted small' }, st ? 'Unknown' : 'Checking…');
    return h('tr', {},
      h('td', {}, h('a', { class: 't-title', href: editUrl(p.path) }, p.title), h('div', { class: 't-url' }, p.url)),
      h('td', {}, TYPE_LABEL[p.type] || 'Page'),
      h('td', {}, live),
      h('td', { class: 'muted small', 'data-hist': p.path }, histDates.get(p.path) || ''),
      h('td', {}, h('div', { class: 'actions', style: { justifyContent: 'flex-end' } }, h('a', { class: 'btn btn-sm', href: editUrl(p.path) }, 'Edit'), h('a', { class: 'btn btn-sm btn-quiet', href: site.liveUrl(p.url), target: '_blank', rel: 'noopener' }, 'View ↗'))));
  };
  const draw = () => {
    const term = q.value.trim().toLowerCase(); const t = type.value;
    const rows = site.pages.filter((p) => (t === 'all' || (t === 'pending' ? ['pending', 'missing'].includes(site.live.get(p.path)) : p.type === t || (t === 'page' && ['home', 'listing'].includes(p.type)))) && (!term || p.title.toLowerCase().includes(term) || p.url.toLowerCase().includes(term)));
    clear(tbody); rows.forEach((p) => tbody.appendChild(rowFor(p)));
    if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No pages match.')));
    count.textContent = plural(rows.length, 'page');
  };
  q.addEventListener('input', debounce(draw, 120)); type.addEventListener('change', draw);
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Pages'), h('p', { class: 'sub' }, 'Every page on the website. Click one to edit it.')),
    h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/posts/new' }, '+ New blog post'), h('button', { class: 'btn', type: 'button', onClick: () => refreshStatus({ force: true }) }, 'Re-check what is live'))));
  root.append(h('div', { class: 'toolbar' }, q, type, h('span', { class: 'grow' }), count));
  root.append(h('div', { class: 'card flush tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Page', 'Type', 'Status', 'Last edited', ''].map((t2) => h('th', {}, t2)))), tbody)));
  draw();
  const onLive = () => { if (document.body.contains(tbody)) draw(); else window.removeEventListener('ids:live-updated', onLive); };
  window.addEventListener('ids:live-updated', onLive);
  // last-edited dates, fetched lazily and cached for the session
  (async () => {
    const list = site.pages.slice(0, 200);
    let i = 0; const worker = async () => { while (i < list.length) { const p = list[i++]; if (!document.body.contains(tbody)) return; try { const hst = await app.gh.history(p.path, { perPage: 1 }); const txt = hst[0] ? `${ago(hst[0].date)} · ${hst[0].author}` : ''; histDates.set(p.path, txt); const cell = tbody.querySelector(`[data-hist="${CSS.escape(p.path)}"]`); if (cell) cell.textContent = txt; } catch { /* ignore */ } } };
    await Promise.all([worker(), worker(), worker()]);
  })();
}
