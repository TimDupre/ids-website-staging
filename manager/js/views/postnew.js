import { h, field, toast, busy } from '../ui.js';
import { go } from '../app.js';
import { newPostSource, slugify, validSlug, pathForSlug, listingCategories, readPost } from '../core/content.js';
import { pickImage } from './media.js';

export async function render(root, params, app) {
  const site = app.site;
  let listing = ''; try { listing = (await site.text('insights/index.html')).src; } catch { /* no listing */ }
  const cats = listing ? listingCategories(listing) : ['Digital Evidence'];
  // layout source: the newest post that uses the clean article layout
  let templatePath = 'insights/falsified-data-in-litigation/index.html';
  if (!site.byPath.has(templatePath)) templatePath = (site.posts.find((p) => p.path !== 'insights/index.html') || {}).path;
  if (!templatePath) throw new Error('There are no existing posts to base the layout on.');

  const title = h('input', { type: 'text', placeholder: 'e.g. What Courts Expect From Digital Evidence', maxlength: 140 });
  const slug = h('input', { type: 'text', class: 'mono', placeholder: 'auto-filled from the title' });
  const cat = h('select', {}, h('option', { value: '', selected: true, disabled: true }, 'Choose a category…'), ...cats.map((c) => h('option', { value: c }, c)));
  const exc = h('textarea', { placeholder: 'One or two sentences that sum the post up. Shown at the top of the post, on the Insights page and in search results.' });
  let image = '';
  const imgBox = h('div'); const drawImg = () => { imgBox.replaceChildren(image ? h('img', { class: 'imgprev', src: site.displaySrc(image), alt: '' }) : h('p', { class: 'small muted' }, 'No image chosen yet.'), h('div', { class: 'actions', style: { marginTop: '6px' } }, h('button', { class: 'btn btn-sm', type: 'button', onClick: async () => { const p = await pickImage(app, { title: 'Main image for the post' }); if (p) { image = p; drawImg(); } } }, image ? 'Change image…' : 'Choose image…'))); }; drawImg();
  const err = h('div', { class: 'banner banner-err', role: 'alert', hidden: true });
  let slugTouched = false;
  title.addEventListener('input', () => { if (!slugTouched) slug.value = slugify(title.value); });
  slug.addEventListener('input', () => { slugTouched = true; });
  const create = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create and start writing');
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'New blog post'), h('p', { class: 'sub' }, 'Step 1 of 2: the basics. Next you will write the article on the page itself.'))));
  root.append(h('div', { class: 'card' }, err, h('form', { onSubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); };
    const t = title.value.trim(); const s = (slug.value.trim() || slugify(t));
    if (!t) return fail('Please enter a title.'); if (!validSlug(s)) return fail('The web address may only use lowercase letters, numbers and single hyphens.');
    if (site.byPath.has(pathForSlug(s)) || site.pages.some((p) => p.url === `/insights/${s}/`)) return fail('A post with that web address already exists. Choose a different one.');
    if (!cat.value) return fail('Please choose a category.'); if (!exc.value.trim()) return fail('Please add a short summary.'); if (!image) return fail('Please choose a main image.');
    const done = busy(create, 'Preparing…');
    try {
      const { src } = await site.text(templatePath);
      const out = newPostSource(src, { title: t, category: cat.value, excerpt: exc.value.trim(), heroImage: image }, { siteUrl: site.siteBase(), slug: s });
      void readPost;
      app.draftPost = { path: pathForSlug(s), src: out }; go('#/edit?new=1');
    } catch (ex) { done(); fail(ex.message || String(ex)); }
  } },
    field('Title', title), field('Web address', h('div', {}, h('span', { class: 'small muted' }, `${site.siteBase()}/insights/`), slug, h('span', { class: 'small muted' }, '/')), 'Choose carefully: it cannot be changed later without breaking links.'),
    field('Category', cat), field('Summary', exc), field('Main image', imgBox), create)));
}
