/*
 * iDS accessibility layer (WCAG 2.1/2.2 AA support) and the accessibility options widget.
 *
 * Page fixes (run on every page, no visible change): skip link, page landmarks (banner, navigation, main,
 * contentinfo), a keyboard-operable mobile menu button, heading order, button semantics for "#" chips,
 * names for image-only links.
 *
 * Widget (bottom-left button): text size, high contrast, underline links, readable font, spacing, pause
 * animations. Preferences are kept in this browser only (localStorage "ids-a11y"). Brand colours only.
 */
(function () {
  'use strict';
  if (window.__idsA11y) return;
  window.__idsA11y = true;

  var KEY = 'ids-a11y';
  var root = document.documentElement;
  var SIZES = [100, 110, 125, 150];
  var state = { size: 0, contrast: false, links: false, font: false, space: false, still: false };

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn('a11y', e); } }

  /* ---------------- page fixes ---------------- */

  function skipLink() {
    if (document.querySelector('.ids-skip')) return;
    var a = el('a', 'ids-skip', { href: '#main-content' });
    a.textContent = 'Skip to main content';
    a.addEventListener('click', function () {
      var m = document.getElementById('main-content');
      if (m) setTimeout(function () { m.focus({ preventScroll: true }); }, 0);
    });
    document.body.insertBefore(a, document.body.firstChild);
  }

  function landmarks() {
    var nav = document.querySelector('.site-nav');
    if (nav && !nav.getAttribute('role')) nav.setAttribute('role', 'banner');
    var links = document.querySelector('.site-nav .nav-links');
    if (links && !links.getAttribute('role')) { links.setAttribute('role', 'navigation'); links.setAttribute('aria-label', 'Main'); }
    var mm = document.querySelector('.nav-mobile-menu');
    if (mm && !mm.getAttribute('role')) { mm.setAttribute('role', 'navigation'); mm.setAttribute('aria-label', 'Mobile'); }

    var kids = [].slice.call(document.body.children);
    var foot = null;
    for (var i = kids.length - 1; i >= 0; i--) {
      var k = kids[i];
      if (k.tagName === 'DIV' && k !== nav && /All Rights Reserved/i.test(k.textContent)) { foot = k; break; }
    }
    if (foot && !foot.getAttribute('role')) foot.setAttribute('role', 'contentinfo');

    if (document.querySelector('main, [role="main"]')) return;
    if (!nav || !foot) return;
    var main = el('main', '', { id: 'main-content', tabindex: '-1' });
    var move = [];
    for (var n = nav.nextElementSibling; n && n !== foot; n = n.nextElementSibling) {
      if (/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) continue;
      if (n.classList.contains('ids-a11y-ui') || n.classList.contains('ids-skip')) continue;
      move.push(n);
    }
    if (!move.length) return;
    document.body.insertBefore(main, foot);
    move.forEach(function (n) { main.appendChild(n); });
  }

  function mobileMenu() {
    var lab = document.querySelector('label[for="nav-toggle"]');
    var cb = document.getElementById('nav-toggle');
    var menu = document.querySelector('.nav-mobile-menu');
    if (!lab || !cb || !menu || document.querySelector('.ids-menu-btn')) return;
    if (!menu.id) menu.id = 'nav-mobile-menu';
    var b = el('button', 'ids-menu-btn', { type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': menu.id });
    b.setAttribute('style', lab.getAttribute('style') || '');
    b.innerHTML = lab.innerHTML;
    lab.parentNode.insertBefore(b, lab);
    lab.style.display = 'none';
    lab.setAttribute('aria-hidden', 'true');
    function sync() { b.setAttribute('aria-expanded', cb.checked ? 'true' : 'false'); }
    b.addEventListener('click', function () { cb.checked = !cb.checked; sync(); });
    cb.addEventListener('change', sync);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && cb.checked) { cb.checked = false; sync(); b.focus(); }
    });
  }

  function headingOrder() {
    var hs = [].slice.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'));
    var prev = 0;
    hs.forEach(function (h) {
      if (h.closest('[hidden]') || h.closest('.ids-a11y-ui')) return;
      var lvl = parseInt(h.getAttribute('aria-level') || (h.tagName.length === 2 ? h.tagName.charAt(1) : '2'), 10);
      if (prev && lvl > prev + 1) { lvl = prev + 1; h.setAttribute('aria-level', String(lvl)); }
      prev = lvl;
    });
  }

  function chipLinks() {
    [].forEach.call(document.querySelectorAll('a[href="#"]'), function (a) {
      if (a.getAttribute('role')) return;
      a.setAttribute('role', 'button');
      a.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); a.click(); }
      });
    });
  }

  function titleCase(s) {
    return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function hasName(a) {
    if (a.getAttribute('aria-label') || a.getAttribute('aria-labelledby') || a.getAttribute('title')) return true;
    if (a.textContent.replace(/\s+/g, '').length) return true;
    var imgs = a.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) if ((imgs[i].getAttribute('alt') || '').trim()) return true;
    return !!a.querySelector('svg[aria-label], svg title');
  }
  function namelessLinks() {
    [].forEach.call(document.querySelectorAll('a[href]'), function (a) {
      if (hasName(a) || a.getAttribute('aria-hidden') === 'true') return;
      if (a.querySelector('img, svg, picture')) {
        var href = a.getAttribute('href') || '';
        var m = /\/our-experts\/(?:#)?([a-z0-9-]+)\/?$/i.exec(href);
        var label;
        if (m) label = titleCase(m[1]) + ' (profile)';
        else { try { label = 'Link to ' + new URL(href, location.href).hostname.replace(/^www\./, ''); } catch (e) { label = 'Link'; } }
        a.setAttribute('aria-label', label);
      } else {
        a.setAttribute('aria-hidden', 'true');
        a.setAttribute('tabindex', '-1');
      }
    });
  }

  function scrollRegions() {
    [].forEach.call(document.querySelectorAll('.bench-track[tabindex="0"]'), function (t) {
      if (!t.getAttribute('role')) t.setAttribute('role', 'region');
      if (!t.getAttribute('aria-label')) t.setAttribute('aria-label', 'Our experts, scrollable list');
    });
  }

  /* ---------------- high contrast (brand navy / white only) ---------------- */

  function rgba(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    var p = m[1].split(/[,\s\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function over(f, b) { var a = f.a; return { r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a), a: 1 }; }
  function lum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); if (x < y) { var t = x; x = y; y = t; } return (x + 0.05) / (y + 0.05); }
  function bgOf(node) {
    var layers = [];
    for (var n = node; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      var c = rgba(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    var base = { r: 255, g: 255, b: 255, a: 1 };
    if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
    while (layers.length) base = over(layers.pop(), base);
    return base;
  }
  function hasText(n) {
    for (var i = 0; i < n.childNodes.length; i++) if (n.childNodes[i].nodeType === 3 && n.childNodes[i].nodeValue.trim()) return true;
    return false;
  }

  var changed = [];
  var seen = typeof WeakSet === 'function' ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  function setImp(node, prop, val) {
    changed.push({ node: node, prop: prop, val: node.style.getPropertyValue(prop), prio: node.style.getPropertyPriority(prop) });
    node.style.setProperty(prop, val, 'important');
  }
  function contrastOn() {
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (seen.has(n) || /^(SCRIPT|STYLE|SVG|PATH|NOSCRIPT|IMG|BR)$/i.test(n.tagName) || n.closest('.ids-a11y-ui') || n.closest('svg')) continue;
      if (!hasText(n)) continue;
      seen.add(n);
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var fg = rgba(cs.color), bg = bgOf(n);
      if (!fg || !bg) continue;
      var f = fg.a < 1 ? over(fg, bg) : fg;
      if (ratio(f, bg) >= 7) continue;
      var own = rgba(cs.backgroundColor);
      if (own && own.a >= 1 && cs.backgroundImage === 'none') {
        if (lum(f) > 0.5) { setImp(n, 'background-color', '#003764'); setImp(n, 'color', '#FFFFFF'); }
        else { setImp(n, 'background-color', '#FFFFFF'); setImp(n, 'color', '#003764'); }
      } else {
        setImp(n, 'color', lum(bg) < 0.18 ? '#FFFFFF' : '#003764');
      }
    }
  }
  function contrastOff() {
    for (var i = changed.length - 1; i >= 0; i--) {
      var c = changed[i];
      if (c.val === '') c.node.style.removeProperty(c.prop); else c.node.style.setProperty(c.prop, c.val, c.prio);
    }
    changed = [];
    seen = typeof WeakSet === 'function' ? new WeakSet() : seen;
  }

  /* ---------------- text size (font sizes only, the layout keeps reflowing normally) ---------------- */

  var sized = [];
  var sizedSeen = typeof WeakSet === 'function' ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  function scaleOn(f) {
    var all = document.body.querySelectorAll('*'), list = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (sizedSeen.has(n) || /^(SCRIPT|STYLE|SVG|PATH|NOSCRIPT|IMG|BR)$/i.test(n.tagName) || n.closest('.ids-a11y-ui') || n.closest('svg')) continue;
      if (n.closest('.site-nav')) continue; /* the header menu is one nowrap row: it would run off narrow screens */
      if (!hasText(n)) continue;
      var cs = getComputedStyle(n);
      if (cs.display === 'none') continue;
      var lh = parseFloat(cs.lineHeight);
      list.push([n, parseFloat(cs.fontSize), isNaN(lh) ? null : lh]);
    }
    list.forEach(function (x) {
      var n = x[0];
      sizedSeen.add(n);
      sized.push({ node: n, fs: n.style.getPropertyValue('font-size'), fsp: n.style.getPropertyPriority('font-size'), lh: n.style.getPropertyValue('line-height'), lhp: n.style.getPropertyPriority('line-height') });
      n.style.setProperty('font-size', (x[1] * f).toFixed(2) + 'px', 'important');
      if (x[2] !== null) n.style.setProperty('line-height', (x[2] * f).toFixed(2) + 'px', 'important');
    });
  }
  function scaleOff() {
    for (var i = sized.length - 1; i >= 0; i--) {
      var s = sized[i];
      if (s.fs === '') s.node.style.removeProperty('font-size'); else s.node.style.setProperty('font-size', s.fs, s.fsp);
      if (s.lh === '') s.node.style.removeProperty('line-height'); else s.node.style.setProperty('line-height', s.lh, s.lhp);
    }
    sized = [];
    if (typeof WeakSet === 'function') sizedSeen = new WeakSet();
  }

  var observer = null, timer = null;
  function watch() {
    if (!window.MutationObserver) return;
    var need = state.contrast || state.size > 0;
    if (need && !observer) {
      observer = new MutationObserver(function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (state.contrast) safe(contrastOn);
          if (state.size > 0) safe(function () { scaleOn(SIZES[state.size] / 100); });
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } else if (!need && observer) { observer.disconnect(); observer = null; }
  }

  /* ---------------- preferences ---------------- */

  function load() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved === 'object') {
      for (var k in state) if (Object.prototype.hasOwnProperty.call(saved, k)) state[k] = saved[k];
      state.size = Math.max(0, Math.min(SIZES.length - 1, parseInt(state.size, 10) || 0));
    } else {
      try {
        if (window.matchMedia('(prefers-contrast: more)').matches) state.contrast = true;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) state.still = true;
      } catch (e) { /* ignore */ }
    }
  }
  function save() {
    var dflt = state.size === 0 && !state.contrast && !state.links && !state.font && !state.space && !state.still;
    try { if (dflt) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  var ui = {};
  function apply(persist) {
    var c = root.classList;
    for (var i = 1; i < SIZES.length; i++) c.toggle('a11y-size-' + i, state.size === i);
    c.toggle('a11y-links', !!state.links);
    c.toggle('a11y-font', !!state.font);
    c.toggle('a11y-space', !!state.space);
    c.toggle('a11y-still', !!state.still);
    c.toggle('a11y-contrast', !!state.contrast);
    safe(scaleOff);
    if (state.size > 0) safe(function () { scaleOn(SIZES[state.size] / 100); });
    safe(contrastOff);
    if (state.contrast) safe(contrastOn);
    watch();
    [].forEach.call(document.querySelectorAll('svg'), function (s) {
      try { if (state.still) s.pauseAnimations(); else s.unpauseAnimations(); } catch (e) { /* not an animated svg */ }
    });
    if (ui.out) ui.out.textContent = SIZES[state.size] + '%';
    if (ui.minus) ui.minus.disabled = state.size === 0;
    if (ui.plus) ui.plus.disabled = state.size === SIZES.length - 1;
    ['contrast', 'links', 'font', 'space', 'still'].forEach(function (k) {
      if (ui[k]) ui[k].setAttribute('aria-pressed', state[k] ? 'true' : 'false');
    });
    if (persist) save();
  }

  /* ---------------- widget ---------------- */

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="4.2" r="2.2" fill="currentColor"/><path d="M4 8.2c5.3 1.2 10.7 1.2 16 0M12 8.6v5.4m0 0-3.4 6.4m3.4-6.4 3.4 6.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function widget() {
    if (document.querySelector('.ids-a11y-ui')) return;
    var wrap = el('div', 'ids-a11y-ui', { role: 'region', 'aria-label': 'Accessibility options' });
    var btn = el('button', 'ids-a11y-btn', { type: 'button', id: 'ids-a11y-btn', 'aria-label': 'Accessibility options', 'aria-expanded': 'false', 'aria-controls': 'ids-a11y-panel' });
    btn.innerHTML = ICON;
    var panel = el('div', 'ids-a11y-panel', { id: 'ids-a11y-panel', role: 'dialog', 'aria-labelledby': 'ids-a11y-title', hidden: '' });

    var head = el('div', 'ids-a11y-head');
    var title = el('p', 'ids-a11y-title', { id: 'ids-a11y-title' });
    title.textContent = 'Accessibility options';
    var x = el('button', 'ids-a11y-x', { type: 'button', 'aria-label': 'Close accessibility options' });
    x.innerHTML = '&times;';
    head.appendChild(title); head.appendChild(x);

    var row = el('div', 'ids-a11y-row');
    var lbl = el('span', 'ids-a11y-lbl', { id: 'ids-a11y-sizelbl' });
    lbl.textContent = 'Text and page size';
    var size = el('div', 'ids-a11y-size', { role: 'group', 'aria-labelledby': 'ids-a11y-sizelbl' });
    var minus = el('button', 'ids-a11y-step', { type: 'button', 'aria-label': 'Decrease size' }); minus.textContent = '−';
    var out = el('output', '', { 'aria-live': 'polite' }); out.textContent = '100%';
    var plus = el('button', 'ids-a11y-step', { type: 'button', 'aria-label': 'Increase size' }); plus.textContent = '+';
    size.appendChild(minus); size.appendChild(out); size.appendChild(plus);
    row.appendChild(lbl); row.appendChild(size);

    var grid = el('div', 'ids-a11y-grid');
    var defs = [['contrast', 'High contrast'], ['links', 'Underline links'], ['font', 'Readable font'], ['space', 'More spacing'], ['still', 'Pause animations']];
    defs.forEach(function (d) {
      var b = el('button', 'ids-a11y-opt', { type: 'button', 'aria-pressed': 'false' });
      b.textContent = d[1];
      b.addEventListener('click', function () { state[d[0]] = !state[d[0]]; apply(true); });
      ui[d[0]] = b; grid.appendChild(b);
    });

    var reset = el('button', 'ids-a11y-reset', { type: 'button' });
    reset.textContent = 'Reset all';
    var note = el('p', 'ids-a11y-note');
    note.innerHTML = 'Settings are saved in this browser only. Trouble using this site? Email <a href="mailto:info@idsinc.com">info@idsinc.com</a> and we will help.';

    panel.appendChild(head); panel.appendChild(row); panel.appendChild(grid); panel.appendChild(reset); panel.appendChild(note);
    wrap.appendChild(btn); wrap.appendChild(panel);
    document.body.appendChild(wrap);
    ui.out = out; ui.minus = minus; ui.plus = plus;

    function open(o) {
      panel.hidden = !o;
      btn.setAttribute('aria-expanded', o ? 'true' : 'false');
      if (o) panel.querySelector('button').focus();
    }
    btn.addEventListener('click', function () { open(panel.hidden); });
    x.addEventListener('click', function () { open(false); btn.focus(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { open(false); btn.focus(); }
    });
    minus.addEventListener('click', function () { if (state.size > 0) { state.size--; apply(true); } });
    plus.addEventListener('click', function () { if (state.size < SIZES.length - 1) { state.size++; apply(true); } });
    reset.addEventListener('click', function () {
      state = { size: 0, contrast: false, links: false, font: false, space: false, still: false };
      apply(true);
    });
  }

  /* Keep the widget clear of the cookie banner while the banner is showing */
  function lift() {
    var w = document.querySelector('.ids-a11y-ui');
    if (!w) return;
    var h = 0, ban = document.querySelector('.cc-banner');
    if (ban && !ban.hidden && ban.getClientRects().length) {
      var cs = getComputedStyle(ban);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') h = Math.max(0, window.innerHeight - ban.getBoundingClientRect().top);
    }
    w.style.setProperty('--ids-a11y-lift', Math.round(h) + 'px');
  }
  function watchBanner() {
    lift();
    window.addEventListener('resize', lift);
    document.addEventListener('click', function () { setTimeout(lift, 150); });
    var n = 0, t = setInterval(function () { lift(); if (++n > 240) clearInterval(t); }, 500);
  }

  function init() {
    safe(skipLink); safe(landmarks); safe(mobileMenu); safe(headingOrder);
    safe(chipLinks); safe(namelessLinks); safe(scrollRegions);
    safe(load); safe(widget); safe(watchBanner); safe(function () { apply(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
