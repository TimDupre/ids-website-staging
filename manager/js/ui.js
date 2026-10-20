// Small DOM toolkit. Text is only ever inserted as text nodes, so page content can never run as HTML in the manager.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'selected', 'disabled', 'hidden', 'indeterminate'].includes(k)) el[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  pages: 'M6 2h9l5 5v15H6zM14 2v6h6',
  posts: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  media: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M9 9.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
  content: 'M4 4h16v6H4zM4 14h7v6H4zM14 14h6v6h-6z',
  globe: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 00-2.2-1.3L14 3h-4l-.4 2.4A7 7 0 007.4 6.7l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9a7 7 0 002.2 1.3L10 21h4l.4-2.4a7 7 0 002.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 4M12 17h.01',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ICONS.pages); svg.appendChild(p);
  return svg;
}

export function toast(msg, kind = 'ok', ms = 5000) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(box); }
  const t = h('div', { class: `toast ${kind === 'err' ? 'err' : ''}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  box.appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? Math.max(ms, 9000) : ms);
  return t;
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prev && prev.focus && prev.focus(); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = h('div', { class: 'mfoot' }, actions.length ? actions.map((a) => h('button', { class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`, type: 'button', disabled: !!a.disabled, onClick: async (e) => { const btn = e.currentTarget; if ((await a.onClick?.(close, btn)) !== false && !a.keepOpen) close(); } }, a.label)) : [h('button', { class: 'btn', type: 'button', onClick: close }, 'Close')]);
  const overlay = h('div', { class: 'overlay', onMousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), h('div', { class: 'mbody' }, body), foot));
  document.body.appendChild(overlay); document.addEventListener('keydown', onKey);
  const first = overlay.querySelector('input,select,textarea'); first && first.focus();
  return { close, el: overlay, foot };
}

export const confirmDialog = (message, { confirmLabel = 'Confirm', danger = false, title = 'Are you sure?' } = {}) => new Promise((resolve) => {
  modal({ title, body: h('p', {}, message), actions: [{ label: 'Cancel', onClick: () => resolve(false) }, { label: confirmLabel, primary: !danger, danger, onClick: () => resolve(true) }], onClose: () => resolve(false) });
});

export function field(label, control, hint) {
  return h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, label), control, hint ? h('span', { class: 'fld-hint' }, hint) : null);
}

export const pill = (text, kind = '') => h('span', { class: `pill ${kind ? 'pill-' + kind : ''}` }, text);

const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso) => (iso ? dtf.format(new Date(iso)) : '');
export function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} days ago`; return fmtDate(iso);
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const copyText = (text) => navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('Clipboard unavailable'));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function busy(btn, label = 'Working…') {
  const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  return () => { btn.disabled = false; btn.textContent = old; };
}
