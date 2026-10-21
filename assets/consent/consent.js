/*
 * iDS cookie consent (UK GDPR / EU GDPR / PECR).
 *
 * Nothing non-essential runs until the visitor opts in:
 *   - "media":     embedded YouTube videos and Blubrry podcast players. In the HTML these
 *                  iframes carry data-consent="media" and data-consent-src instead of src.
 *   - "analytics": site analytics. Not installed yet. When it is, set ANALYTICS_ID below
 *                  (a GA4 "G-..." measurement ID) and it loads only after consent.
 *
 * The choice is kept in localStorage ("ids-consent"). Visitors can change it any time via
 * the "Cookie settings" link in the footer, or window.idsConsent.open().
 */
(function () {
  var ANALYTICS_ID = '';            // e.g. 'G-XXXXXXXXXX' once the GA4 property exists
  var HUBSPOT_ID = '51886431';      // HubSpot portal ID: its tracking code loads only after the visitor allows analytics
  var KEY = 'ids-consent', VERSION = 1;
  var listeners = [];

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && v.v === VERSION ? v : null;
    } catch (e) { return null; }
  }
  function write(c) {
    c.v = VERSION; c.ts = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    state = c; apply(); listeners.forEach(function (fn) { try { fn(c); } catch (e) {} });
  }
  var state = read();

  /* ---------- analytics (Google Consent Mode v2 defaults to denied) ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  var gaLoaded = false;
  function applyAnalytics() {
    var ok = !!(state && state.analytics);
    gtag('consent', 'update', { analytics_storage: ok ? 'granted' : 'denied' });
    if (!ok || !ANALYTICS_ID || gaLoaded) return;
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ANALYTICS_ID;
    document.head.appendChild(s);
    window.gtag = gtag; gtag('js', new Date()); gtag('config', ANALYTICS_ID, { anonymize_ip: true });
  }

  /* ---------- HubSpot tracking code (analytics category) ---------- */
  var hsLoaded = false;
  function applyHubspot() {
    var ok = !!(state && state.analytics);
    if (!ok) { if (hsLoaded) { window._hsq = window._hsq || []; window._hsq.push(['revokeCookieConsent']); } return; }
    if (!HUBSPOT_ID || hsLoaded) return;
    hsLoaded = true;
    var s = document.createElement('script');
    s.id = 'hs-script-loader'; s.async = true; s.defer = true; s.src = 'https://js.hs-scripts.com/' + HUBSPOT_ID + '.js';
    document.head.appendChild(s);
  }

  /* ---------- embedded media ---------- */
  function provider(src) { return /youtube/.test(src) ? 'YouTube' : /blubrry/.test(src) ? 'Blubrry' : 'a third party'; }
  function loadFrame(f) {
    if (f.getAttribute('src')) return;
    f.setAttribute('src', f.getAttribute('data-consent-src'));
    f.hidden = false;
    var ph = f.previousElementSibling;
    if (ph && ph.classList.contains('cc-embed')) ph.remove();
  }
  function placeholder(f) {
    var prev = f.previousElementSibling;
    if (prev && prev.classList.contains('cc-embed')) return;
    var src = f.getAttribute('data-consent-src'), who = provider(src), video = who === 'YouTube';
    var ph = document.createElement('div');
    ph.className = 'cc-embed' + (video ? ' cc-embed-video' : ' cc-embed-audio');
    var watch = '';
    var id = video && src.match(/embed\/([\w-]{6,})/);
    if (id) watch = ' <a class="cc-embed-ext" href="https://www.youtube.com/watch?v=' + id[1] + '" target="_blank" rel="noopener">Watch on YouTube</a>';
    ph.innerHTML = '<div class="cc-embed-in"><p>This ' + (video ? 'video' : 'podcast episode') + ' is hosted by ' + who +
      ', which may set cookies once it loads.</p><div class="cc-embed-btns"><button type="button" class="cc-btn cc-primary" data-cc-load>' +
      (video ? 'Load video' : 'Load player') + '</button><button type="button" class="cc-btn" data-cc-always>Always allow embedded media</button>' + watch + '</div></div>';
    ph.querySelector('[data-cc-load]').addEventListener('click', function () { loadFrame(f); });
    ph.querySelector('[data-cc-always]').addEventListener('click', function () {
      var c = state || { analytics: false }; c.media = true; write(c);
    });
    f.hidden = true;
    f.parentNode.insertBefore(ph, f);
  }
  function applyMedia() {
    var ok = !!(state && state.media);
    document.querySelectorAll('iframe[data-consent="media"]').forEach(function (f) {
      if (ok) loadFrame(f); else if (!f.getAttribute('src')) placeholder(f);
    });
  }

  function apply() { applyAnalytics(); applyHubspot(); applyMedia(); }

  /* ---------- banner and preferences ---------- */
  var banner, dialog;
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function showBanner() {
    if (banner) { banner.hidden = false; return; }
    banner = el('<section class="cc-banner" role="region" aria-label="Cookie consent"><div class="cc-wrap">' +
      '<div class="cc-text"><h2>Your privacy</h2><p>We use essential storage to run this site. With your permission, we would also like to load embedded media (YouTube videos and podcast players), which may set their own cookies, and use analytics to understand how the site is used. You can change your choice at any time under Cookie settings. <a href="/privacy-policy/">Privacy Policy</a></p></div>' +
      '<div class="cc-actions"><button type="button" class="cc-btn cc-primary" data-cc="all">Accept all</button>' +
      '<button type="button" class="cc-btn cc-primary" data-cc="none">Reject non-essential</button>' +
      '<button type="button" class="cc-btn cc-link" data-cc="manage">Manage preferences</button></div></div></section>');
    banner.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cc]'); if (!b) return;
      var a = b.getAttribute('data-cc');
      if (a === 'all') { write({ analytics: true, media: true }); banner.hidden = true; }
      if (a === 'none') { write({ analytics: false, media: false }); banner.hidden = true; }
      if (a === 'manage') openPrefs();
    });
    document.body.appendChild(banner);
  }
  function openPrefs() {
    var c = state || { analytics: false, media: false };
    if (!dialog) {
      dialog = el('<div class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-title" hidden><div class="cc-panel">' +
        '<h2 id="cc-title">Cookie settings</h2><p>Choose which optional features you allow. Essential storage keeps the site working and remembers this choice.</p>' +
        '<div class="cc-row"><div><b>Essential</b><span>Needed for the site to work. Always on.</span></div><input type="checkbox" checked disabled aria-label="Essential, always on"></div>' +
        '<label class="cc-row"><div><b>Embedded media</b><span>YouTube videos and Blubrry podcast players. These services may set their own cookies.</span></div><input type="checkbox" name="media"></label>' +
        '<label class="cc-row"><div><b>Analytics</b><span>Uses HubSpot to understand which pages and content are useful, and to connect a form you submit with the pages you viewed. No advertising.</span></div><input type="checkbox" name="analytics"></label>' +
        '<div class="cc-actions"><button type="button" class="cc-btn cc-primary" data-cc="save">Save choices</button>' +
        '<button type="button" class="cc-btn" data-cc="all">Accept all</button><button type="button" class="cc-btn" data-cc="none">Reject non-essential</button></div>' +
        '<button type="button" class="cc-close" aria-label="Close" data-cc="close">&times;</button></div></div>');
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) return closePrefs();
        var b = e.target.closest('[data-cc]'); if (!b) return;
        var a = b.getAttribute('data-cc');
        if (a === 'close') return closePrefs();
        if (a === 'save') write({ media: dialog.querySelector('[name=media]').checked, analytics: dialog.querySelector('[name=analytics]').checked });
        if (a === 'all') write({ analytics: true, media: true });
        if (a === 'none') write({ analytics: false, media: false });
        if (banner) banner.hidden = true;
        closePrefs();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog && !dialog.hidden) closePrefs(); });
      document.body.appendChild(dialog);
    }
    dialog.querySelector('[name=media]').checked = !!c.media;
    dialog.querySelector('[name=analytics]').checked = !!c.analytics;
    dialog.hidden = false;
    dialog.querySelector('[name=media]').focus();
  }
  function closePrefs() { if (dialog) dialog.hidden = true; }

  window.idsConsent = {
    get: function () { return state; },
    open: openPrefs,
    onChange: function (fn) { listeners.push(fn); }
  };

  function init() {
    apply();
    if (!state) showBanner();
    document.querySelectorAll('[data-cookie-settings]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openPrefs(); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
