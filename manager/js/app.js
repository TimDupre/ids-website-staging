import { h, clear, icon, toast, modal, field, pill, busy } from './ui.js';
import { GitHub, GitHubError } from './github.js';
import { Site } from './site.js';
import { tokenStore } from './store.js';

export const app = { cfg: null, gh: null, site: null, user: null, guard: null, statusEl: null, root: document.getElementById('app') };

const ROUTES = {
  '': () => import('./views/dashboard.js'),
  'pages': () => import('./views/pages.js'),
  'edit': () => import('./views/editor.js'),
  'posts': () => import('./views/posts.js'),
  'posts/new': () => import('./views/postnew.js'),
  'media': () => import('./views/media.js'),
  'home': () => import('./views/homecontent.js'),
  'sitewide': () => import('./views/sitewide.js'),
  'settings': () => import('./views/settings.js'),
  'help': () => import('./views/help.js'),
};
const NAV = [
  ['', 'Dashboard', 'home'], ['pages', 'Pages', 'pages'], ['posts', 'Blog posts', 'posts'], ['media', 'Media', 'media'], ['home', 'Home content', 'content'], ['sitewide', 'Site-wide blocks', 'globe'], ['help', 'Help', 'help'], ['settings', 'Settings', 'gear'],
];

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, ''); const [p, q] = raw.split('?');
  return { path: p || '', params: new URLSearchParams(q || '') };
}
export const go = (hash) => { location.hash = hash; };
export const editUrl = (path, extra = '') => `#/edit?path=${encodeURIComponent(path)}${extra}`;

/* ------------------------------------------------------------------ start */

async function boot() {
  try {
    const r = await fetch('config.json', { cache: 'no-store' }); app.cfg = await r.json();
  } catch { app.root.replaceChildren(h('p', { class: 'boot' }, 'Could not load the manager settings (config.json).')); return; }
  const token = tokenStore.get();
  if (!token) return authScreen();
  try { await connect(token, tokenStore.remembered(), { silent: true }); }
  catch (e) { authScreen(e.message); }
}

export function newClient(token) {
  return new GitHub({ token, owner: app.cfg.repo.owner, repo: app.cfg.repo.repo, branch: app.cfg.repo.branch, apiBase: app.cfg.apiBase });
}

export async function connect(token, remember, { silent } = {}) {
  const gh = newClient(token);
  const user = await gh.verify();
  app.gh = gh; app.user = user;
  tokenStore.set(token, remember);
  app.site = new Site(app.cfg, gh);
  await loadSite();
  startShell();
  if (!silent) toast(`Connected as ${user.login}.`);
}

async function loadSite(onDone) {
  const bar = h('i'); const label = h('p', { class: 'muted' }, 'Reading the website…');
  app.root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'card' }, h('h1', {}, 'iDS Site Manager'), label, h('div', { class: 'progress' }, bar))));
  await app.site.load((done, total) => { if (total) { bar.style.width = `${Math.round((done / total) * 100)}%`; label.textContent = `Reading the website… ${done} of ${total} pages (only needed the first time)`; } });
  onDone && onDone();
}

export async function reloadSite() { await app.site.afterCommit(); refreshStatus(); }

/* -------------------------------------------------------------- sign-in */

function authScreen(error) {
  const token = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…', 'aria-label': 'GitHub access token' });
  const remember = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'banner banner-err', role: 'alert', hidden: !error }, error || '');
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Connect');
  const { owner, repo } = app.cfg.repo;
  app.root.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'card' },
      h('h1', {}, 'iDS Site Manager'),
      h('p', { class: 'muted' }, 'Edit every page and blog post on the website, like WordPress. Changes are saved straight to the website’s code repository, with full history.'),
      h('h2', {}, 'Connect with a GitHub access token'),
      h('p', { class: 'small muted' }, 'You do this once per computer. The token is a password that only works for this one repository.'),
      h('ol', {},
        h('li', {}, 'Sign in to GitHub, then ', h('a', { href: app.cfg.tokenHelpUrl, target: '_blank', rel: 'noopener' }, 'create a fine-grained token'), '.'),
        h('li', {}, 'Name it "Site Manager". Expiration: 90 days or longer. Repository access: ', h('b', {}, 'Only select repositories'), ' → ', h('span', { class: 'code' }, `${owner}/${repo}`), '.'),
        h('li', {}, 'Under Permissions → Repository, set ', h('b', {}, 'Contents'), ' to ', h('b', {}, 'Read and write'), ' (leave everything else as it is).'),
        h('li', {}, 'Click Generate token, copy it, and paste it below.')),
      err,
      h('form', { onSubmit: async (e) => {
        e.preventDefault(); const t = token.value.trim(); if (!t) return;
        const done = busy(btn, 'Connecting…'); err.hidden = true;
        try { await connect(t, remember.checked); } catch (ex) { done(); err.textContent = ex.message || String(ex); err.hidden = false; }
      } },
        field('Access token', token),
        h('label', { class: 'check' }, remember, h('span', {}, 'Remember me on this computer (otherwise you will be asked again after closing the browser)')),
        btn))));
}

export function signOut() { tokenStore.clear(); app.gh = null; app.site = null; location.hash = ''; authScreen(); }

/* --------------------------------------------------------------- shell */

function startShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(([r, label, ic]) => h('a', { href: `#/${r}`, 'data-r': r }, icon(ic), label)));
  const status = h('div', { class: 'status-chip' });
  app.statusEl = status;
  const view = h('div', { id: 'view' });
  app.root.replaceChildren(h('div', { class: 'shell', id: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, 'iDS ', h('b', {}, 'Site Manager'), h('small', {}, `${app.cfg.repo.owner}/${app.cfg.repo.repo}`)),
      nav,
      h('div', { class: 'side-foot' }, h('div', { class: 'who' }, app.user.name || app.user.login), h('div', { class: 'muted', style: { color: '#8fb0d0' } }, app.user.canPush ? 'Can edit and publish' : 'Read-only access'), h('button', { class: 'btn btn-sm', type: 'button', onClick: signOut }, 'Sign out'))),
    h('div', { class: 'main' },
      h('div', { class: 'topbar', id: 'topbar' }, status, h('span', { class: 'grow' }), h('a', { class: 'btn btn-sm', href: app.site.siteBase(), target: '_blank', rel: 'noopener' }, 'View live site ↗')),
      view)));
  if (!app.user.canPush) view.before(h('div', { class: 'banner banner-warn', style: { margin: '12px 24px 0' } }, 'This token can read the site but not change it. Create a token with "Contents: Read and write" to publish edits.'));
  window.removeEventListener('hashchange', onHash); window.addEventListener('hashchange', onHash);
  window.addEventListener('beforeunload', (e) => { if (app.guard && app.guard()) { e.preventDefault(); e.returnValue = ''; } });
  refreshStatus();
  route();
}

let lastHash = location.hash;
function onHash() {
  if (app.guard) {
    const msg = app.guard();
    if (msg && !window.confirm(`${typeof msg === 'string' ? msg : 'You have unpublished changes on this page.'}\n\nLeave without publishing?`)) { history.replaceState(null, '', lastHash || '#/'); return; }
    app.guard = null;
  }
  lastHash = location.hash; route();
}

let routeSeq = 0;
export async function route() {
  const { path, params } = parseHash(); const seq = ++routeSeq;
  const key = Object.keys(ROUTES).includes(path) ? path : '';
  const nav = document.querySelectorAll('.nav a'); nav.forEach((a) => a.classList.toggle('on', a.dataset.r === (key === 'edit' ? 'pages' : key.split('/')[0] === 'posts' ? 'posts' : key)));
  const view = document.getElementById('shell') ? document.getElementById('view') : null; if (!view) return;
  document.getElementById('shell').classList.toggle('editing', key === 'edit');
  const page = h('div', { class: 'page' }, h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Loading…'));
  clear(view); view.appendChild(page);
  try {
    const mod = await ROUTES[key]();
    if (seq !== routeSeq) return;
    const fresh = h('div', { class: key === 'edit' ? '' : 'page' });
    await mod.render(fresh, params, app);
    if (seq !== routeSeq) return;
    clear(view); view.appendChild(fresh); window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== routeSeq) return;
    console.error(e);
    clear(view); view.appendChild(h('div', { class: 'page' }, h('div', { class: 'banner banner-err', role: 'alert' }, e instanceof GitHubError ? e.message : `Something went wrong: ${e.message || e}`)));
  }
}

/* ---------------------------------------------------------------- status */

let checking = false;
export async function refreshStatus({ force = false } = {}) {
  if (!app.site || !app.statusEl) return;
  paintStatus('checking');
  if (checking && !force) return; checking = true;
  try { await app.site.checkLive(() => {}); } finally { checking = false; }
  paintStatus();
  window.dispatchEvent(new CustomEvent('ids:live-updated'));
}
function paintStatus(state) {
  const el = app.statusEl; if (!el) return; clear(el);
  if (state === 'checking') { el.append(h('span', { class: 'spinner' }), ' ', h('span', { class: 'muted small' }, 'Checking what is live…')); return; }
  const n = app.site.pendingCount();
  if (n === 0) { el.append(pill('Everything is live', 'ok')); return; }
  el.append(pill(`${n} ${n === 1 ? 'page' : 'pages'} changed, not live yet`, 'warn'), ' ',
    h('a', { class: 'btn btn-sm btn-primary', href: app.cfg.deploy.manualDeployUrl, target: '_blank', rel: 'noopener', title: 'Opens the hosting dashboard. Click Deploy, then purge the cache.' }, 'Deploy ↗'), ' ',
    h('a', { class: 'btn btn-sm', href: app.cfg.deploy.purgeUrl, target: '_blank', rel: 'noopener' }, 'Purge cache ↗'), ' ',
    h('button', { class: 'btn btn-sm btn-quiet', type: 'button', onClick: () => refreshStatus({ force: true }) }, 'Re-check'));
}

export function announcePublished(result, { what = 'Published', paths = [] } = {}) {
  const t = toast(h('span', {}, `${what}. It will appear on the live site after the next deploy. `, h('a', { href: app.cfg.deploy.manualDeployUrl, target: '_blank', rel: 'noopener' }, 'Deploy now ↗')), 'ok', 12000);
  void t;
  refreshStatus({ force: true });
}

export { modal };
boot();
