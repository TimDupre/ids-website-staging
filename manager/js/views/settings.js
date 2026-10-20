import { h, pill, field, toast, busy } from '../ui.js';
import { tokenStore } from '../store.js';
import { signOut, connect } from '../app.js';

export async function render(root, params, app) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', { class: 'sub' }, 'Your connection to the website.'))));
  const u = app.user;
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Connection'),
    h('table', { class: 'tbl' }, h('tbody', {},
      h('tr', {}, h('td', {}, 'Signed in as'), h('td', {}, `${u.name || u.login} (${u.login})`)),
      h('tr', {}, h('td', {}, 'Website repository'), h('td', {}, h('a', { href: `https://github.com/${u.fullName}`, target: '_blank', rel: 'noopener' }, u.fullName), ' ', u.private ? pill('private') : pill('public', 'warn'))),
      h('tr', {}, h('td', {}, 'Branch being edited'), h('td', { class: 'mono' }, app.cfg.repo.branch)),
      h('tr', {}, h('td', {}, 'Permission'), h('td', {}, u.canPush ? pill('Can edit and publish', 'ok') : pill('Read-only', 'warn'))),
      h('tr', {}, h('td', {}, 'Token stored'), h('td', {}, tokenStore.remembered() ? 'On this computer (until you sign out)' : 'This browser session only')),
      h('tr', {}, h('td', {}, 'Live site'), h('td', {}, h('a', { href: app.cfg.siteUrl, target: '_blank', rel: 'noopener' }, app.cfg.siteUrl))))),
    h('div', { class: 'actions', style: { marginTop: '14px' } }, h('button', { class: 'btn', type: 'button', onClick: signOut }, 'Sign out and forget the token'))));
  const t = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' }); const rem = h('input', { type: 'checkbox', checked: tokenStore.remembered() }); const b = h('button', { class: 'btn', type: 'button' }, 'Replace token');
  b.addEventListener('click', async () => { if (!t.value.trim()) return; const done = busy(b); try { await connect(t.value.trim(), rem.checked); } catch (e) { done(); toast(e.message, 'err'); } });
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Replace the access token'), h('p', { class: 'small muted' }, 'Tokens expire. When yours is close to expiring, create a new one the same way as before and paste it here.'),
    field('New token', t), h('label', { class: 'check' }, rem, h('span', {}, 'Remember on this computer')), b));
  root.append(h('div', { class: 'card' }, h('h2', {}, 'Going live'), h('p', {}, 'Publishing saves your edit to the website’s code repository. The hosting service then needs two clicks to make it public:'),
    h('ol', {}, h('li', {}, h('b', {}, 'Deploy'), ' – ', h('a', { href: app.cfg.deploy.manualDeployUrl, target: '_blank', rel: 'noopener' }, 'open the Deploy panel ↗'), ' and press Deploy.'), h('li', {}, h('b', {}, 'Purge cache'), ' – ', h('a', { href: app.cfg.deploy.purgeUrl, target: '_blank', rel: 'noopener' }, 'open Networking ↗'), ' and press Purge cache, so visitors see the new version straight away.')),
    h('p', { class: 'small muted' }, 'A deploy publishes everything saved to the website, including changes made by anyone else.')));
}
