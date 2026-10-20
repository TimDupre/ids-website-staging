// One page being edited: working copy, undo/redo, and a human-readable change log. No DOM, so it is unit-tested in Node.
import { analyze, applyOp, textOf } from './htmlpatch.js';

const STRUCTURAL = new Set(['duplicate', 'remove', 'move', 'insertAfter', 'insertBefore', 'insertInside']);
const clip = (s, n = 70) => { const t = String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export class EditSession {
  constructor({ path, sha = null, src, opts = {}, isNew = false }) {
    this.path = path; this.baseSha = sha; this.original = src; this.src = src; this.isNew = isNew;
    this.opts = opts.invertLock && !opts.frozenLocks ? { ...opts, frozenLocks: analyze(src, opts).lock } : opts;
    this.undoStack = []; this.redoStack = []; this.log = []; this._a = null;
  }
  get dirty() { return this.isNew || this.src !== this.original; }
  analysis() { if (!this._a || this._a.src !== this.src) this._a = analyze(this.src, this.opts); return this._a; }

  /** Apply one operation. Returns { rerender } - true when element numbering/structure changed so the preview must be rebuilt. */
  apply(op, describe) {
    const before = this.src; const a = this.analysis();
    let label = describe;
    if (!label) label = this.describe(op, a);
    const next = applyOp(before, op, this.opts);
    if (next === before) return { rerender: false, changed: false };
    this.undoStack.push({ src: before, label }); if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0; this.src = next; this._a = null;
    if (label) this.log.push(label);
    const rerender = STRUCTURAL.has(op.type) || this.analysis().nodes.length !== a.nodes.length;
    return { rerender, changed: true };
  }
  describe(op, a) {
    const b = (ord) => a.blocks.find((x) => x.ord === ord);
    switch (op.type) {
      case 'setInner': { const x = b(op.ord); return x ? `Edited text: “${clip(op.html, 60)}”` : 'Edited text'; }
      case 'setAttr': { const el = a.nodes[op.ord]; const t = el && el.tagName; return t === 'img' ? (op.name === 'src' ? 'Replaced an image' : op.name === 'alt' ? 'Changed image description' : `Changed image ${op.name}`) : `Changed ${t || 'element'} ${op.name}`; }
      case 'duplicate': return 'Duplicated a section'; case 'remove': return 'Deleted a section'; case 'move': return op.dir < 0 ? 'Moved a section up' : 'Moved a section down';
      case 'insertAfter': case 'insertInside': case 'insertBefore': return 'Added a block';
      case 'setTitle': return `Changed page title to “${clip(op.text)}”`;
      case 'setMeta': return `Changed ${op.key.replace(/^og:/, 'social ')} setting`;
      default: return op.type;
    }
  }
  undo() { const e = this.undoStack.pop(); if (!e) return false; this.redoStack.push({ src: this.src, label: e.label }); this.src = e.src; this._a = null; this.log.pop(); return true; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; this.undoStack.push({ src: this.src, label: e.label }); this.src = e.src; this._a = null; if (e.label) this.log.push(e.label); return true; }
  replaceAll(src, label = 'Restored an earlier version') { this.undoStack.push({ src: this.src, label }); this.redoStack.length = 0; this.src = src; this._a = null; this.log.push(label); }
  discard() { this.src = this.original; this.undoStack = []; this.redoStack = []; this.log = []; this._a = null; }
  markPublished(src, sha) { this.original = src; this.src = src; this.baseSha = sha; this.isNew = false; this.undoStack = []; this.redoStack = []; this.log = []; this._a = null; }

  /** Collapse the log into a short list for the publish dialog. */
  summary() {
    const counts = new Map();
    for (const l of this.log) { const key = l.startsWith('Edited text') ? 'Edited text' : l; counts.set(key, (counts.get(key) || 0) + 1); }
    return [...counts].map(([k, n]) => (n > 1 ? `${k} (×${n})` : k));
  }
  textBlocksChanged() { return this.log.filter((l) => l.startsWith('Edited text')).length; }
}
export { textOf };
