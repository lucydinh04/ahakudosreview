/* AHAKUDOS Review — feedback service. The ONLY code that talks to /api/feedback (→ tab WEB_FEEDBACK).
   It never calls the KUDOS bridge. Errors are returned as rejected promises with a code; the store decides the fallback. */
(function () {
  'use strict';
  const CONFIG = (() => { try { return JSON.parse(document.getElementById('ahakudos-config').textContent || '{}'); } catch (e) { return {}; } })();
  const BASE = String(CONFIG.basePath || '');
  class FeedbackError extends Error { constructor(message, code) { super(message); this.code = code || 'ERROR'; } }
  async function request(method, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(BASE + '/api/feedback', {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
      });
      const json = await res.json().catch(() => null);
      if (!json || typeof json.ok !== 'boolean') throw new FeedbackError('Phản hồi máy chủ feedback không hợp lệ.', 'INVALID_RESPONSE');
      if (!json.ok) throw new FeedbackError(json.error || 'Không thể lưu feedback lúc này.', json.code);
      return json.data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new FeedbackError('Máy chủ feedback phản hồi quá lâu.', 'TIMEOUT');
      if (e instanceof FeedbackError) throw e;
      throw new FeedbackError('Không kết nối được máy chủ feedback.', 'NETWORK');
    } finally { clearTimeout(timer); }
  }
  window.AhaReview = window.AhaReview || {};
  window.AhaReview.service = Object.freeze({
    config: CONFIG.review || {},
    list: () => request('GET'),
    create: item => request('POST', { action: 'create', item }),
    setStatus: (id, status, note) => request('POST', { action: 'status', id, status, note: note || '' })
  });
})();
