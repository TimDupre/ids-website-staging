import { h, clear, field, toast, busy, pill, plural } from '../ui.js';
import { announcePublished, reloadSite } from '../app.js';

const SECTIONS = { hero: 'Hero (top of the page)', reassembly: 'Reassembly graphic', storyBrand: 'What you get when you call', plan: 'How an engagement works', howWeHelp: 'How we help', statementBand: 'Statement band', canYou: 'Can You…? teaser', beyond: 'Beyond eDiscovery' };
const LABELS = { ctaPrimary: 'Main button text', ctaSecondary: 'Second button text', ctaFinal: 'Final link text', q: 'Question', tag: 'Tagline', num: 'Number', body2: 'Second paragraph', body1: 'First paragraph', head: 'Heading', text: 'Text', goal: 'Goal', title: 'Title', label: 'Label', eyebrow: 'Small heading above', headline: 'Headline', body: 'Paragraph', sources: 'Sources', questions: 'Questions', points: 'Points', notList: '“We are not…” list', weAreLabel: '“We are” label', weAreText: '“We are” text', foundationEyebrow: 'Foundation: small heading', foundationTitle: 'Foundation: title', foundationSub: 'Foundation: subtitle', foundationText: 'Foundation: text', resultLabel: 'Result label', resultText: 'Result text', footnote: 'Footnote', lead: 'Lead sentence', cards: 'Cards', steps: 'Steps', verticals: 'Phases' };
const pretty = (k) => LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export async function render(root, params, app) {
  const site = app.site; const path = 'content/home.json';
  if (!site.byPath.has(path)) throw new Error('The home page content file (content/home.json) was not found in the repository.');
  const { src, sha } = await site.text(path); const data = JSON.parse(src); const original = JSON.stringify(data);
  const changed = () => JSON.stringify(data) !== original;
  const pub = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Publish'); const dirtyPill = h('span', { class: 'hidden' }, pill('Unpublished changes', 'warn'));
  const touch = () => { const d = changed(); pub.disabled = !d || !app.user.canPush; dirtyPill.classList.toggle('hidden', !d); app.guard = d ? () => 'You have unpublished changes to the home page content.' : null; };

  const input = (get, set, long) => {
    const el = long ? h('textarea', { rows: Math.min(8, Math.max(3, Math.ceil(String(get()).length / 70))) }, String(get())) : h('input', { type: 'text', value: String(get()) });
    el.addEventListener('input', () => { set(el.value); touch(); }); return el;
  };
  function node(obj, key, depth) {
    const v = obj[key];
    if (typeof v === 'string') return field(pretty(key), input(() => obj[key], (x) => { obj[key] = x; }, v.length > 80 || v.includes('\n')));
    if (Array.isArray(v)) {
      const box = h('div', { class: 'fieldset' }, h('div', { class: 'fs-title' }, pretty(key)));
      const strings = v.every((x) => typeof x === 'string');
      const draw = () => {
        [...box.querySelectorAll('.listitem, .fieldset, .add')].forEach((n) => n.remove());
        v.forEach((item, i) => {
          if (strings) {
            const row = h('div', { class: 'listitem' }, input(() => v[i], (x) => { v[i] = x; }, String(v[i]).length > 80), h('button', { class: 'btn btn-sm btn-quiet', type: 'button', title: 'Remove', onClick: () => { v.splice(i, 1); draw(); touch(); } }, '✕'));
            box.appendChild(row);
          } else {
            const fs = h('div', { class: 'fieldset' }, h('div', { class: 'fs-title' }, `${pretty(key).replace(/s$/, '')} ${i + 1}`)); Object.keys(item).forEach((k) => fs.appendChild(node(item, k, depth + 1))); box.appendChild(fs);
          }
        });
        if (strings) box.appendChild(h('button', { class: 'btn btn-sm add', type: 'button', onClick: () => { v.push('New item'); draw(); touch(); } }, '+ Add'));
      };
      draw(); return box;
    }
    const fs = h('div', { class: 'fieldset' }, h('div', { class: 'fs-title' }, depth === 0 ? SECTIONS[key] || pretty(key) : pretty(key))); Object.keys(v).forEach((k) => fs.appendChild(node(v, k, depth + 1))); return fs;
  }
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Home content'), h('p', { class: 'sub' }, 'The words on the home page. Layout and images are edited like any other page.')), h('div', { class: 'actions' }, dirtyPill, h('a', { class: 'btn btn-sm', href: site.siteBase() + '/', target: '_blank', rel: 'noopener' }, 'View home page ↗'), h('a', { class: 'btn btn-sm', href: '#/edit?path=index.html' }, 'Edit layout & images'), pub)));
  root.append(h('div', { class: 'banner banner-info small' }, 'Short fields stay short: the page is designed around these lengths, so keep headlines and buttons brief.'));
  Object.keys(data).forEach((k) => root.appendChild(h('div', { class: 'card' }, node(data, k, 0))));
  pub.addEventListener('click', async () => {
    const done = busy(pub, 'Publishing…');
    try {
      const text = JSON.stringify(data, null, 2) + '\n';
      await app.gh.commit({ message: 'Update home page content', changes: [{ path, text }], expect: { [path]: sha } });
      app.guard = null; await reloadSite(); announcePublished(null, { what: 'Home content published' }); location.reload();
    } catch (e) { done(); toast(e.code === 'file-changed' ? 'Someone else changed the home content while you were editing. Reload the page and try again.' : e.message, 'err'); }
  });
  void clear; void plural;
}
