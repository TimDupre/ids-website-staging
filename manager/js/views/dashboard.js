import { h, pill, ago, plural } from '../ui.js';
import { editUrl, refreshStatus } from '../app.js';

export async function render(root, params, app) {
  const site = app.site;
  const pages = site.pages.filter((p) => p.type !== 'post');
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Dashboard'), h('p', { class: 'sub' }, 'Everything on the website, in one place.')),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/posts/new' }, '+ New blog post'), h('a', { class: 'btn', href: '#/pages' }, 'Edit a page'))));

  const pendingEl = h('b', {}, '…');
  root.append(h('div', { class: 'tiles' },
    h('a', { class: 'tile', href: '#/pages' }, h('b', {}, String(pages.length)), h('span', {}, 'Pages')),
    h('a', { class: 'tile', href: '#/posts' }, h('b', {}, String(site.posts.length)), h('span', {}, 'Blog posts')),
    h('a', { class: 'tile', href: '#/media' }, h('b', {}, String(site.media().length)), h('span', {}, 'Images')),
    h('a', { class: 'tile', href: '#/pages?show=pending' }, pendingEl, h('span', {}, 'Changed, not live yet'))));
  const updatePending = () => { pendingEl.textContent = String(site.pendingCount()); };
  updatePending(); window.addEventListener('ids:live-updated', updatePending, { once: false });

  const act = h('div', { class: 'card' }, h('h2', {}, 'Recent changes'), h('p', { class: 'muted' }, 'Loading…'));
  const quick = h('div', { class: 'card' }, h('h2', {}, 'Quick start'),
    h('ul', {}, h('li', {}, h('a', { href: '#/pages' }, 'Edit any page'), ' by clicking directly on its text.'),
      h('li', {}, h('a', { href: '#/posts/new' }, 'Write a new blog post'), ' and it is added to the Insights page and sitemap for you.'),
      h('li', {}, h('a', { href: '#/media' }, 'Upload images'), ' and use them on any page.'),
      h('li', {}, h('a', { href: '#/sitewide' }, 'Change the header, footer or call-to-action'), ' once, everywhere.'),
      h('li', {}, 'After publishing, press ', h('b', {}, 'Deploy'), ' (top of the screen) to make changes live.')));
  root.append(h('div', { class: 'row' }, h('div', {}, act), h('div', {}, quick)));
  try {
    const list = await app.gh.api('GET', `${app.gh.repoPath}/commits?sha=${encodeURIComponent(app.gh.branch)}&per_page=12`);
    act.replaceChildren(h('h2', {}, 'Recent changes'), h('table', { class: 'tbl' }, h('tbody', {}, list.map((c) => h('tr', {}, h('td', {}, c.commit.message.split('\n')[0].slice(0, 90)), h('td', { class: 'muted small' }, (c.author && c.author.login) || c.commit.author.name), h('td', { class: 'muted small' }, ago(c.commit.author.date)))))));
  } catch (e) { act.replaceChildren(h('h2', {}, 'Recent changes'), h('p', { class: 'muted' }, 'Could not load the history right now.')); }
  void editUrl; void pill; void plural; void refreshStatus;
}
