import { h } from '../ui.js';

export async function render(root) {
  const sec = (t, ...kids) => h('div', { class: 'card' }, h('h2', {}, t), ...kids);
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Help'), h('p', { class: 'sub' }, 'How the Site Manager works.'))));
  root.append(
    sec('Editing a page', h('ul', {},
      h('li', {}, 'Open ', h('b', {}, 'Pages'), ' and click a page. It opens exactly as visitors see it.'),
      h('li', {}, 'Click any text and type. Use the toolbar for bold, italic and links. Click an image to replace it or change its description.'),
      h('li', {}, h('b', {}, 'Duplicate'), ', ', h('b', {}, 'Move'), ' and ', h('b', {}, 'Delete'), ' work on whichever block or section is selected. Use ', h('b', {}, 'Select parent'), ' to select the box around a block (for example a whole card).'),
      h('li', {}, 'The right-hand panel has the page title and search description (', h('b', {}, 'Page'), ') and earlier versions (', h('b', {}, 'History'), ').'),
      h('li', {}, 'Press ', h('b', {}, 'Publish'), ' to save. Nothing changes on the website until you publish.'))),
    sec('Hatched or locked areas', h('p', {}, 'The menu, footer and the “Start building your narrative” band appear on every page. They are locked on individual pages so a page cannot end up different from the rest. Change them once under ', h('a', { href: '#/sitewide' }, 'Site-wide blocks'), '.')),
    sec('Blog posts', h('p', {}, h('a', { href: '#/posts/new' }, 'New blog post'), ' asks for a title, category, summary and image, then opens the writing screen. Publishing adds the post to the Insights page and the sitemap automatically. Deleting a post removes it from both.')),
    sec('The home page', h('p', {}, 'The home page text comes from a content file, so it is edited under ', h('a', { href: '#/home' }, 'Home content'), ' using simple forms. Its layout is edited like any other page.')),
    sec('Going live', h('p', {}, 'Publishing saves your change. Then press ', h('b', {}, 'Deploy'), ' at the top of the screen and, afterwards, ', h('b', {}, 'Clear cache'), ' (also at the top of every screen). A deploy publishes everything saved to the website, including other people’s changes.')),
    sec('If something goes wrong', h('ul', {},
      h('li', {}, h('b', {}, '“Changed by someone else”'), ': another person saved that page while you were editing. Reload the page to see their version, then redo your edit.'),
      h('li', {}, h('b', {}, 'Undo a published edit'), ': open the page, choose ', h('b', {}, 'History'), ', pick the earlier version and Publish it.'),
      h('li', {}, h('b', {}, 'Token expired'), ': create a new one (Settings) and replace it.'))));
}
