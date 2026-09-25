/* AHAKUDOS Review — sign-in (email + shared review access code). */
(function () {
  'use strict';
  let cfg = {}; try { cfg = JSON.parse(document.getElementById('ahakudos-config').textContent || '{}'); } catch (e) { cfg = {}; }
  const base = cfg.basePath || '';
  const needKey = !!(cfg.review && cfg.review.needKey);
  if (needKey) { document.getElementById('key-field').hidden = false; document.getElementById('key').required = true; }
  const form = document.getElementById('login'), err = document.getElementById('error'), btn = document.getElementById('submit');
  form.addEventListener('submit', e => {
    e.preventDefault(); btn.disabled = true; err.textContent = '';
    const email = document.getElementById('email').value.trim(), key = needKey ? document.getElementById('key').value : '';
    document.getElementById('key').value = '';
    fetch(base + '/api/review-login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email, key }) })
      .then(r => r.json().catch(() => ({ ok: false, error: 'Phản hồi không hợp lệ.' })).then(d => { if (!r.ok || !d.ok) throw new Error(d.error || 'Chưa đăng nhập được.'); location.reload(); }))
      .catch(x => { err.textContent = x.message; btn.disabled = false; });
  });
})();
