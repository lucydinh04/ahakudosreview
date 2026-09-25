/* AHAKUDOS boot guard — loaded before the app. Guarantees the page never stays on
   "Đang kết nối…" forever: any startup error, API failure or timeout shows a clear message,
   and the technical error is logged to the console. */
(function () {
  'use strict';
  var ready = false, BOOT_TIMEOUT_MS = 65000;
  function el(tag, attrs, text) { var n = document.createElement(tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (text) n.textContent = text; return n; }
  function show(title, message) {
    var app = document.getElementById('app'); if (!app) return;
    var box = el('section', { 'class': 'aha-fatal', role: 'alert', style: 'max-width:640px;margin:72px auto;padding:32px;background:#fff;border:1px solid #E1E8F0;border-radius:24px;text-align:center;font-family:Lexend,Arial,sans-serif;color:#0e4174' });
    box.appendChild(el('div', { style: 'font-size:20px;font-weight:800;margin-bottom:18px' }, 'Ahamove · AHAKUDOS'));
    box.appendChild(el('h1', { style: 'font-size:22px;margin:0 0 10px' }, title || 'Không thể kết nối AHAKUDOS.'));
    box.appendChild(el('p', { style: 'font-size:15px;line-height:1.7;color:#52657c;margin:0 0 20px' }, message || 'Vui lòng tải lại trang hoặc thử lại sau.'));
    var b = el('button', { type: 'button', style: 'border:0;border-radius:12px;background:#ff7f32;color:#fff;font:700 15px Lexend,Arial,sans-serif;padding:12px 24px;cursor:pointer' }, 'Tải lại trang');
    b.addEventListener('click', function () { location.reload(); });
    box.appendChild(b);
    app.innerHTML = ''; app.appendChild(box);
  }
  var timer = setTimeout(function () { if (!ready) { console.error('[AHAKUDOS] boot timeout after ' + BOOT_TIMEOUT_MS + 'ms'); show(); } }, BOOT_TIMEOUT_MS);
  window.AhaKudosBoot = {
    ready: function () { ready = true; clearTimeout(timer); },
    isReady: function () { return ready; },
    fail: function (err, copy) {
      console.error('[AHAKUDOS] startup failed', err);
      ready = true; clearTimeout(timer);
      show(copy && copy.title, copy && copy.message);
    }
  };
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window) return; // resource errors are handled by the app
    console.error('[AHAKUDOS] uncaught error', e.error || e.message);
    if (!ready) window.AhaKudosBoot.fail(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    console.error('[AHAKUDOS] unhandled rejection', e.reason);
    if (!ready) window.AhaKudosBoot.fail(e.reason);
  });
  // Images: optional fallback / hide without inline handlers (CSP forbids inline script).
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    if (t.getAttribute('data-fallback') && t.getAttribute('src') !== t.getAttribute('data-fallback')) { t.setAttribute('src', t.getAttribute('data-fallback')); t.removeAttribute('data-fallback'); }
    else if (t.hasAttribute('data-hide-on-error')) t.style.display = 'none';
  }, true);
})();
