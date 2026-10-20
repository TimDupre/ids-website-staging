import { h, plural, field } from '../ui.js';

export async function render(root, params, app) {
  const site = app.site; const n = site.pages.length;
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Site-wide blocks'), h('p', { class: 'sub' }, 'Parts of the site that appear on every page: the menu, the call-to-action band and the footer.'))));
  const sel = h('select', { 'aria-label': 'Page to edit on' }, site.pages.filter((p) => !['home'].includes(p.type) && p.type !== 'post').map((p) => h('option', { value: p.path, selected: p.path === 'about/index.html' }, `${p.title} (${p.url})`)));
  root.append(h('div', { class: 'card' },
    h('h2', {}, 'How it works'),
    h('ol', {}, h('li', {}, 'Open any page below. Its menu, footer and call-to-action band become editable; the rest of the page is locked.'),
      h('li', {}, 'Change the wording or links, then press ', h('b', {}, 'Publish everywhere'), '.'),
      h('li', {}, 'The same change is made on every page that has that block. You see how many pages will change before anything is saved.')),
    field('Edit on this page', sel, `The block is the same on all ${n} pages; this just chooses which page to look at.`),
    h('a', { class: 'btn btn-primary', href: '#', onClick: (e) => { e.preventDefault(); location.hash = `#/edit?mode=sitewide&path=${encodeURIComponent(sel.value)}`; } }, 'Open the site-wide editor')));
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Good to know'), h('ul', {}, h('li', {}, `${plural(site.shared.size, 'shared block')} detected across the site (blocks identical on many pages).`), h('li', {}, 'Blocks that differ slightly on a few pages (for example, a menu item highlighted for the current page) are only changed where they match.'), h('li', {}, 'Page-specific text is edited from ', h('a', { href: '#/pages' }, 'Pages'), '.'))));
}
