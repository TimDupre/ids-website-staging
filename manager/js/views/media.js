import { h, clear, modal, toast, field, plural, bytes, debounce, copyText } from '../ui.js';
import { slugify } from '../core/content.js';
import { bytesToB64 } from '../github.js';
import { reloadSite } from '../app.js';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_WIDTH = 2400;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

async function shrink(file) {
  const ext = TYPES[file.type];
  if (!ext || ext === 'svg' || ext === 'gif') return { bytes: new Uint8Array(await file.arrayBuffer()), ext, resized: false };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a readable image.')); i.src = url; });
    if (img.naturalWidth <= MAX_WIDTH) return { bytes: new Uint8Array(await file.arrayBuffer()), ext, resized: false };
    const scale = MAX_WIDTH / img.naturalWidth; const c = document.createElement('canvas'); c.width = MAX_WIDTH; c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const outType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, outType, 0.9));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext, resized: true };
  } finally { URL.revokeObjectURL(url); }
}

/** Validate, shrink, name and publish images in ONE commit. Returns the new repository paths. */
export async function uploadFiles(app, files) {
  const site = app.site; const taken = new Set(site.entries.map((e) => e.path)); const changes = []; const out = []; const urls = [];
  for (const f of files) {
    if (!TYPES[f.type]) throw new Error(`"${f.name}" is not a supported image (use JPG, PNG, WebP, GIF or SVG).`);
    if (f.size > MAX_BYTES) throw new Error(`"${f.name}" is larger than ${bytes(MAX_BYTES)}. Please make it smaller first.`);
    const { bytes: data, ext } = await shrink(f);
    const base = slugify(f.name.replace(/\.[^.]+$/, '')) || 'image';
    let name = `${base}.${ext}`, n = 2; while (taken.has(`assets/uploads/${name}`)) name = `${base}-${n++}.${ext}`;
    const path = `assets/uploads/${name}`; taken.add(path);
    changes.push({ path, base64: bytesToB64(data) }); out.push(path); urls.push([path, URL.createObjectURL(new Blob([data], { type: f.type }))]);
  }
  await app.gh.commit({ message: files.length === 1 ? `Upload image: ${out[0].split('/').pop()}` : `Upload ${files.length} images`, changes });
  for (const [p, u] of urls) site.localAssets.set('/' + p, u);
  await reloadSite();
  return out;
}

function dropZone(app, onDone) {
  const input = h('input', { type: 'file', accept: Object.keys(TYPES).join(','), multiple: true, class: 'hidden' });
  const zone = h('div', { class: 'drop' }, h('div', {}, h('b', {}, 'Drop images here'), ' or ', h('button', { class: 'btn btn-sm', type: 'button', onClick: () => input.click() }, 'choose files')), h('div', { class: 'small' }, 'JPG, PNG, WebP, GIF or SVG, up to 12 MB. Large photos are reduced to a web-friendly size automatically.'));
  const run = async (files) => {
    const list = [...files]; if (!list.length) return;
    const label = zone.querySelector('div'); const idle = [...label.childNodes];
    zone.classList.add('over'); label.textContent = `Uploading ${plural(list.length, 'image')}…`;
    try { const paths = await uploadFiles(app, list); toast(`Uploaded ${plural(paths.length, 'image')}.`); onDone(paths); }
    catch (e) { toast(e.message || String(e), 'err'); }
    finally { zone.classList.remove('over'); label.replaceChildren(...idle); input.value = ''; }
  };
  input.addEventListener('change', () => run(input.files));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); }); zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); run(e.dataTransfer.files); });
  return h('div', {}, zone, input);
}

function gridFor(app, { onPick, selected }) {
  const q = h('input', { type: 'search', placeholder: 'Search by file name…', 'aria-label': 'Search images' });
  const folderSel = h('select', { 'aria-label': 'Folder' });
  const grid = h('div', { class: 'mgrid' }); const count = h('span', { class: 'muted small' });
  let items = [];
  const refresh = () => {
    items = app.site.media().sort((a, b) => a.name.localeCompare(b.name));
    const folders = [...new Set(items.map((i) => i.folder))].sort();
    const cur = folderSel.value || 'assets/uploads'; clear(folderSel);
    folderSel.append(h('option', { value: '' }, 'All folders'), ...folders.map((f) => h('option', { value: f, selected: f === cur }, f.replace(/^assets\//, ''))));
    if (!folders.includes(cur) && cur !== '') folderSel.value = '';
    draw();
  };
  const draw = () => {
    const term = q.value.trim().toLowerCase(); const f = folderSel.value;
    const list = items.filter((i) => (!f || i.folder === f) && (!term || i.name.toLowerCase().includes(term)));
    clear(grid);
    list.slice(0, 400).forEach((i) => {
      const b = h('button', { type: 'button', class: `mitem ${selected && selected() === i.path ? 'sel' : ''}`, title: i.path, onClick: () => { grid.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); onPick(i); } },
        h('span', { class: 'th', style: { backgroundImage: `url("${app.site.displaySrc('/' + i.path)}")` } }), h('span', { class: 'nm' }, i.name));
      grid.appendChild(b);
    });
    if (!list.length) grid.appendChild(h('p', { class: 'muted' }, 'No images match.'));
    count.textContent = list.length > 400 ? `Showing 400 of ${list.length}` : plural(list.length, 'image');
  };
  q.addEventListener('input', debounce(draw, 120)); folderSel.addEventListener('change', draw);
  folderSel.value = 'assets/uploads'; refresh();
  return { el: h('div', {}, h('div', { class: 'toolbar' }, q, folderSel, h('span', { class: 'grow' }), count), grid), refresh };
}

/** Modal picker used by the editor. Resolves to a root-relative path like "/assets/uploads/photo.jpg", or null. */
export function pickImage(app, { title = 'Choose an image' } = {}) {
  return new Promise((resolve) => {
    let chosen = null; let result = null; let m;
    const g = gridFor(app, { onPick: (i) => { chosen = '/' + i.path; useBtn.disabled = false; }, selected: () => chosen && chosen.slice(1) });
    const useBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onClick: () => { result = chosen; m.close(); } }, 'Use this image');
    const dz = dropZone(app, (paths) => { chosen = '/' + paths[0]; useBtn.disabled = false; g.refresh(); });
    m = modal({ title, wide: true, body: h('div', {}, dz, h('div', { style: { height: '12px' } }), g.el), actions: [], onClose: () => resolve(result) });
    m.foot.replaceChildren(h('button', { class: 'btn', type: 'button', onClick: () => m.close() }, 'Cancel'), useBtn);
  });
}

export async function render(root, params, app) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Media'), h('p', { class: 'sub' }, 'Images used on the website. Upload new ones here or from inside the editor.'))));
  const g = gridFor(app, { onPick: (i) => detail(i) });
  const detail = (i) => {
    const url = app.site.displaySrc('/' + i.path);
    modal({ title: i.name, body: h('div', {}, h('img', { src: url, alt: '', class: 'imgprev', style: { maxHeight: '320px' } }), h('p', { class: 'small muted' }, `${i.path} · ${bytes(i.size || 0)}`), h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'button', onClick: () => copyText('/' + i.path).then(() => toast('Path copied.')) }, 'Copy path'), h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, 'Open full size ↗'))) });
  };
  root.append(h('div', { class: 'card' }, dropZone(app, () => g.refresh())), g.el);
  void field;
}
