/* AHAKUDOS Review — feedback UI: Review Bar, Feedback Mode, "!" indicators, section panel and global sidebar.
   Lives ON TOP of the unchanged AHAKUDOS UI. Indicators are drawn in a separate overlay layer (absolute, document
   coordinates) so the page layout never moves. User text is always rendered with textContent — never parsed as HTML. */
(function () {
  'use strict';
  try { start(); } catch (e) { console.error('[AHAKUDOS Review] feedback layer disabled', e); } // never break the app
  function start() {
  const R = window.AhaReview;
  if (!R || !R.store || !R.sections) return;
  const store = R.store, S = store.state;
  const AUTHOR_KEY = 'reviewFeedbackAuthor', MODE_KEY = 'ahakudos-review-fb-mode', SCENARIO_KEY = 'ahakudos-review-scenario';
  const safeGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const safeSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const STATUS_LABEL = { OPEN: 'Open', IN_PROGRESS: 'In progress', DONE: 'Done' };

  /* ---------- tiny DOM helper (text only) ---------- */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(text) {
    const root = document.getElementById('toast-root') || document.body;
    const t = el('div', { class: 'toast aha-review-ui', text }); root.appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  const fmtTime = iso => { const d = new Date(iso); return isFinite(d.getTime()) ? d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; };
  const currentPage = () => (window.AhaKudosApp && window.AhaKudosApp.page()) || 'unknown';
  const sectionById = id => R.sections.find(s => s.id === id) || { id, label: id, pages: ['*'] };

  /* ---------- 1. Tag sections with stable data-feedback-id ---------- */
  function tagSections() {
    const page = currentPage();
    R.sections.forEach(s => {
      if (!s.pages.includes('*') && !s.pages.includes(page)) return;
      const nodes = s.many ? document.querySelectorAll('#app ' + s.selector) : [document.querySelector('#app ' + s.selector)];
      nodes.forEach(n => { if (n && !n.dataset.feedbackId) { n.dataset.feedbackId = s.id; n.dataset.feedbackLabel = s.label; } });
    });
  }

  /* ---------- 2. Review Bar + floating toggle (review UI only) ---------- */
  const cfg = R.service.config || {};
  const scenario = safeGet(SCENARIO_KEY) || 'default';
  const bar = el('div', { class: 'aha-review-bar aha-review-ui', role: 'region', 'aria-label': 'Review Mode' });
  const countBtn = el('button', { type: 'button', class: 'aha-rv-count', onclick: () => openSidebar() });
  const modeBtn = el('button', { type: 'button', class: 'aha-rv-mode', 'aria-pressed': 'false', onclick: () => setMode(!document.body.classList.contains('fb-mode')) });
  const scenarioSel = el('select', { class: 'aha-rv-scenario', 'aria-label': 'Review scenario', onchange: e => { safeSet(SCENARIO_KEY, e.target.value); location.hash = ''; location.reload(); } });
  const pendingNote = el('button', { type: 'button', class: 'aha-rv-pending', hidden: true, onclick: async () => { const r = await store.syncPending(); toast(r.left ? 'Vẫn chưa đồng bộ được ' + r.left + ' feedback.' : 'Đã đồng bộ ' + r.synced + ' feedback.'); } });
  bar.append(
    el('div', { class: 'aha-rv-brand' }, el('b', { text: 'AHAKUDOS Review' }), el('span', { class: 'aha-rv-flag', text: 'REVIEW MODE' }), el('span', { class: 'aha-rv-note', text: 'Không phải dữ liệu production' })),
    el('div', { class: 'aha-rv-meta' }, el('span', { class: 'aha-rv-version', text: 'Version: ' + (S.currentVersion || cfg.version || '—') }), el('label', { class: 'aha-rv-scn' }, el('span', { text: 'Scenario' }), scenarioSel)),
    el('div', { class: 'aha-rv-actions' }, pendingNote, countBtn, modeBtn,
      el('span', { class: 'aha-rv-who', title: 'Đang đăng nhập bản review', text: (cfg.role === 'dev' ? 'Dev · ' : 'Reviewer · ') + (cfg.reviewer || '') }),
      el('button', { type: 'button', class: 'aha-rv-logout', text: 'Đăng xuất', onclick: () => fetch((JSON.parse(document.getElementById('ahakudos-config').textContent || '{}').basePath || '') + '/api/review-login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }).finally(() => location.reload()) }))
  );
  document.body.insertBefore(bar, document.getElementById('app'));
  const fab = el('button', { type: 'button', class: 'aha-rv-fab aha-review-ui', onclick: () => setMode(!document.body.classList.contains('fb-mode')) });
  document.body.appendChild(fab);
  document.body.classList.add('review-mode');

  function renderBar() {
    const n = store.getUnresolvedCount();
    countBtn.replaceChildren(el('span', { text: '💬 Feedback' }), el('span', { class: 'aha-rv-badge' + (n ? '' : ' is-zero'), text: n ? '! ' + n : '0' }));
    countBtn.setAttribute('aria-label', n + ' feedback chưa xử lý — mở danh sách');
    const on = document.body.classList.contains('fb-mode');
    modeBtn.textContent = 'Feedback Mode: ' + (on ? 'ON' : 'OFF'); modeBtn.setAttribute('aria-pressed', String(on)); modeBtn.classList.toggle('is-on', on);
    fab.textContent = on ? '✕ Tắt Feedback mode' : '💬 Feedback mode'; fab.classList.toggle('is-on', on);
    const p = S.pending.length; pendingNote.hidden = !p; pendingNote.textContent = '⚠ ' + p + ' feedback chưa đồng bộ · Đồng bộ lại';
  }
  function fillScenarios(list) {
    if (!list || !list.length || scenarioSel.options.length) return;
    list.forEach(s => scenarioSel.appendChild(el('option', { value: s.id, text: s.label, selected: s.id === scenario })));
  }

  /* ---------- 3. Feedback Mode (hover outline + click to comment) ---------- */
  let hoverEl = null;
  function setMode(on) {
    document.body.classList.toggle('fb-mode', !!on);
    if (!on && hoverEl) { hoverEl.classList.remove('fb-hover'); hoverEl = null; }
    renderBar(); if (on) toast('Feedback Mode: bấm vào một khu vực có viền cam để góp ý.');
  }
  const isReviewUi = t => !!(t && t.closest && t.closest('.aha-review-ui'));
  document.addEventListener('mouseover', e => {
    if (!document.body.classList.contains('fb-mode') || isReviewUi(e.target)) return;
    const s = e.target.closest && e.target.closest('[data-feedback-id]');
    if (s === hoverEl) return; if (hoverEl) hoverEl.classList.remove('fb-hover'); hoverEl = s; if (s) s.classList.add('fb-hover');
  });
  // Capture phase: in Feedback Mode a click comments on the section instead of triggering the app.
  document.addEventListener('click', e => {
    if (!document.body.classList.contains('fb-mode') || isReviewUi(e.target)) return;
    if (!e.target.closest || !e.target.closest('#app')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const s = e.target.closest('[data-feedback-id]');
    if (!s) { toast('Khu vực này chưa hỗ trợ góp ý — chọn vùng có viền cam.'); return; }
    openSection(s.dataset.feedbackId, s);
  }, true);

  /* ---------- 4. "!" indicators (overlay, never inside the layout) ---------- */
  const layer = el('div', { class: 'aha-fb-layer aha-review-ui', 'aria-live': 'polite' });
  document.body.appendChild(layer);
  function drawIndicators() {
    tagSections();
    const seen = new Set(), frag = document.createDocumentFragment();
    document.querySelectorAll('#app [data-feedback-id]').forEach(n => {
      const id = n.dataset.feedbackId; if (seen.has(id)) return; // one badge per section id (first match)
      const st = store.getSectionFeedbackState(id); if (!st.unresolved) return;
      const r = n.getBoundingClientRect(); if (!r.width || !r.height) return;
      seen.add(id);
      const b = el('button', { type: 'button', class: 'aha-fb-dot is-' + (st.state === 'OPEN' ? 'open' : 'progress'), title: st.unresolved + ' feedback chưa xử lý: ' + (n.dataset.feedbackLabel || id),
        'aria-label': st.unresolved + ' feedback chưa xử lý ở ' + (n.dataset.feedbackLabel || id), onclick: ev => { ev.stopPropagation(); openSection(id, n); } },
        el('span', { text: '!' }), st.unresolved > 1 ? el('b', { text: String(st.unresolved) }) : null);
      b.style.top = Math.max(0, r.top + window.scrollY + 6) + 'px';
      b.style.left = (r.right + window.scrollX - 8) + 'px';
      frag.appendChild(b);
    });
    layer.replaceChildren(frag);
  }
  let drawQueued = false;
  const queueDraw = () => { if (drawQueued) return; drawQueued = true; setTimeout(() => { drawQueued = false; drawIndicators(); }, 60); }; // timer (not rAF) so it also runs in background tabs
  new MutationObserver(queueDraw).observe(document.getElementById('app'), { childList: true, subtree: true });
  window.addEventListener('resize', queueDraw);
  document.addEventListener('load', queueDraw, true); // images changing layout
  if (window.ResizeObserver) new ResizeObserver(queueDraw).observe(document.body);

  /* ---------- 5. Drawer: section panel + global sidebar ---------- */
  const drawer = el('aside', { class: 'aha-fb-drawer aha-review-ui', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Feedback', hidden: true });
  document.body.appendChild(drawer);
  let view = null, selectedEl = null;
  function closeDrawer() { drawer.hidden = true; view = null; S.currentSection = null; if (selectedEl) selectedEl.classList.remove('fb-selected'); selectedEl = null; document.body.classList.remove('fb-drawer-open'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
  function drawerShell(title, sub, body) {
    drawer.replaceChildren(
      el('div', { class: 'aha-fb-head' }, el('div', {}, el('div', { class: 'aha-fb-kicker', text: 'FEEDBACK · ' + (S.currentVersion || '') }), el('h2', { text: title }), sub ? el('p', { class: 'aha-fb-sub', text: sub }) : null),
        el('button', { type: 'button', class: 'aha-fb-close', 'aria-label': 'Đóng', text: '×', onclick: closeDrawer })),
      body);
    drawer.hidden = false; document.body.classList.add('fb-drawer-open');
  }
  function statusChip(st, local) { return el('span', { class: 'aha-fb-status is-' + st.toLowerCase(), text: local ? 'Chưa đồng bộ' : STATUS_LABEL[st] }); }
  const ACTION_TEXT = h => h.action === 'CREATED' ? 'Tạo feedback' : h.action === 'REOPENED' ? 'Mở lại (Done → Open)' : (STATUS_LABEL[h.from] || h.from) + ' → ' + (STATUS_LABEL[h.to] || h.to);
  function historyList(id) {
    const list = store.historyFor(id);
    if (!list.length) return el('p', { class: 'aha-fb-empty', text: 'Chưa có lịch sử.' });
    return el('ol', { class: 'aha-fb-history' }, list.map(h => el('li', {}, el('time', { text: fmtTime(h.at) }), el('b', { text: ACTION_TEXT(h) }), el('span', { class: 'aha-fb-by', text: h.by || '' }), h.note ? el('p', { class: 'aha-fb-note', text: h.note }) : null)));
  }
  /** Dev only: change status with an optional note ("đã sửa gì"). Reviewers only see the status. */
  function statusActions(it) {
    if (!store.isDev() || it.local) return [];
    const note = el('input', { class: 'aha-fb-input aha-fb-noteinput', type: 'text', maxlength: '1000', placeholder: 'Ghi chú đã sửa gì (không bắt buộc)', 'aria-label': 'Ghi chú sửa đổi' });
    const go = async (status) => {
      try { await store.updateFeedbackStatus(it.id, status, cfg.reviewer || '', note.value.trim()); }
      catch (e) { toast('Không đổi được trạng thái: ' + (e.message || 'lỗi kết nối') + '. Vui lòng thử lại.'); }
    };
    const btn = (label, status, primary) => el('button', { type: 'button', class: 'aha-fb-act' + (primary ? ' is-primary' : ''), text: label, onclick: () => go(status) });
    const buttons = it.status === 'OPEN' ? [btn('Bắt đầu xử lý', 'IN_PROGRESS', true), btn('Đánh dấu Done', 'DONE')]
      : it.status === 'IN_PROGRESS' ? [btn('Đánh dấu Done', 'DONE', true), btn('Mở lại', 'OPEN')] : [btn('Mở lại', 'OPEN')];
    return [note, ...buttons];
  }
  function itemCard(it, withContext) {
    return el('article', { class: 'aha-fb-item' + (it.local ? ' is-local' : '') },
      el('div', { class: 'aha-fb-item-head' }, el('b', { text: it.author || 'Ẩn danh' }), statusChip(it.status, it.local), el('time', { text: fmtTime(it.createdAt) })),
      withContext ? el('div', { class: 'aha-fb-ctx', text: (it.sectionLabel || it.sectionId) + ' · ' + it.page + (it.reviewVersion !== S.currentVersion ? ' · ' + it.reviewVersion : '') }) : null,
      el('p', { class: 'aha-fb-comment', text: it.comment }),
      it.local ? el('p', { class: 'aha-fb-warn', text: 'Feedback này hiện chỉ được lưu trên trình duyệt và chưa được đồng bộ.' }) : null,
      el('div', { class: 'aha-fb-acts' }, statusActions(it)),
      it.local ? null : (() => { const n = store.historyFor(it.id).length; const box = el('div', { class: 'aha-fb-histbox', hidden: true });
        const t = el('button', { type: 'button', class: 'aha-fb-histtoggle', 'aria-expanded': 'false', text: '🕘 Lịch sử (' + n + ')', onclick: e => { e.stopPropagation(); const open = box.hidden; box.hidden = !open; t.setAttribute('aria-expanded', String(open)); if (open) box.replaceChildren(historyList(it.id)); } });
        return el('div', {}, t, box); })());
  }
  function snapshotText(n) { return n ? String(n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : ''; }

  function openSection(sectionId, node) {
    const sec = sectionById(sectionId);
    if (selectedEl) selectedEl.classList.remove('fb-selected');
    selectedEl = node || document.querySelector('#app [data-feedback-id="' + CSS.escape(sectionId) + '"]');
    if (selectedEl) selectedEl.classList.add('fb-selected');
    view = { kind: 'section', sectionId, label: (node && node.dataset.feedbackLabel) || sec.label }; S.currentSection = sectionId;
    renderSection();
  }
  function renderSection() {
    const { sectionId, label } = view, page = currentPage();
    const list = store.getFeedbackForSection(sectionId);
    const older = store.getFeedbackForSection(sectionId, { allVersions: true }).length - list.length;
    const reviewer = cfg.reviewer || '';
    const text = el('textarea', { class: 'aha-fb-input', rows: '4', maxlength: '2000', placeholder: 'Góp ý cho khu vực này…', 'aria-label': 'Nội dung feedback' });
    const err = el('p', { class: 'aha-fb-error', hidden: true });
    text.addEventListener('input', () => { err.hidden = true; });
    const send = el('button', { type: 'button', class: 'aha-fb-send', text: 'Gửi feedback' });
    send.addEventListener('click', async () => {
      const author = reviewer, comment = text.value.trim();
      if (comment.length < 2) { err.textContent = 'Nhập nội dung feedback.'; err.hidden = false; text.focus(); return; }
      safeSet(AUTHOR_KEY, author); send.disabled = true; send.textContent = 'Đang gửi…';
      try {
        const r = await store.createFeedback({ page, sectionId, sectionLabel: label, elementText: snapshotText(selectedEl), author, comment });
        toast(r.synced ? 'Đã lưu feedback 🧡' : 'Không thể lưu feedback lúc này. Feedback này hiện chỉ được lưu trên trình duyệt và chưa được đồng bộ.');
        renderSection();
      } catch (e) { err.textContent = e.message || 'Không thể lưu feedback lúc này. Vui lòng thử lại.'; err.hidden = false; send.disabled = false; send.textContent = 'Gửi feedback'; }
    });
    drawerShell(label, null, el('div', { class: 'aha-fb-body' },
      el('dl', { class: 'aha-fb-meta' }, el('dt', { text: 'Section' }), el('dd', { text: sectionId }), el('dt', { text: 'Page' }), el('dd', { text: page }), el('dt', { text: 'Review Version' }), el('dd', { text: S.currentVersion || '' })),
      el('h3', { text: 'Feedback hiện có (' + list.length + ')' }),
      list.length ? el('div', { class: 'aha-fb-list' }, list.map(it => itemCard(it, false))) : el('p', { class: 'aha-fb-empty', text: 'Chưa có feedback cho khu vực này ở version hiện tại.' }),
      older > 0 ? el('p', { class: 'aha-fb-empty', text: older + ' feedback thuộc version cũ — xem trong danh sách (All versions).' }) : null,
      el('div', { class: 'aha-fb-form' }, el('h3', { text: 'Gửi feedback mới' }), el('p', { class: 'aha-fb-sub', text: 'Người góp ý: ' + (reviewer || '—') }), text, err, send)));
  }
  function openSidebar() { view = { kind: 'list' }; if (selectedEl) selectedEl.classList.remove('fb-selected'); selectedEl = null; renderSidebar(); }
  function renderSidebar() {
    const seg = (items, cur, onPick) => el('div', { class: 'aha-fb-seg', role: 'group' }, items.map(([v, l]) => el('button', { type: 'button', class: cur === v ? 'is-active' : '', 'aria-pressed': String(cur === v), text: l, onclick: () => { onPick(v); renderSidebar(); } })));
    const list = store.filteredItems();
    if (S.filter === 'HISTORY') return renderHistory(seg);
    drawerShell(store.isDev() ? 'Feedback (tất cả)' : 'Feedback của bạn', store.getUnresolvedCount() + ' chưa xử lý ở ' + (S.currentVersion || 'version hiện tại'), el('div', { class: 'aha-fb-body' },
      S.error ? el('div', { class: 'aha-fb-alert' }, el('span', { text: 'Không tải được feedback: ' + S.error }), el('button', { type: 'button', class: 'aha-fb-act', text: 'Thử lại', onclick: () => store.loadFeedback() })) : null,
      seg([['ALL', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['DONE', 'Done'], ['HISTORY', '🕘 Lịch sử']], S.filter, v => store.setFilter(v)),
      el('div', { class: 'aha-fb-row' }, seg([['current', 'Current version'], ['all', 'All versions']], S.versionFilter, v => store.setVersionFilter(v)),
        el('label', { class: 'aha-fb-mine' }, el('input', { type: 'checkbox', checked: S.mine, onchange: e => { store.setMine(e.target.checked); renderSidebar(); } }), 'Mine')),
      list.length ? el('div', { class: 'aha-fb-list' }, list.map(it => { const c = itemCard(it, true); c.classList.add('is-link'); c.addEventListener('click', e => { if (e.target.closest('button,input,textarea,.aha-fb-histbox')) return; goToFeedback(it); }); return c; }))
        : el('p', { class: 'aha-fb-empty', text: S.loading ? 'Đang tải feedback…' : 'Không có feedback nào khớp bộ lọc.' })));
  }
  /** Everything that changed, newest first (dev: all feedback; reviewer: their own). */
  function renderHistory(seg) {
    const byId = {}; store.state.items.forEach(x => { byId[x.id] = x; });
    const rows = store.recentHistory().filter(h => S.versionFilter === 'all' || (byId[h.feedbackId] && byId[h.feedbackId].reviewVersion === S.currentVersion));
    drawerShell('Lịch sử sửa đổi', rows.length + ' thay đổi · ' + (store.isDev() ? 'toàn bộ feedback' : 'feedback của bạn'), el('div', { class: 'aha-fb-body' },
      seg([['ALL', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['DONE', 'Done'], ['HISTORY', '🕘 Lịch sử']], S.filter, v => store.setFilter(v)),
      seg([['current', 'Current version'], ['all', 'All versions']], S.versionFilter, v => store.setVersionFilter(v)),
      rows.length ? el('ol', { class: 'aha-fb-history is-global' }, rows.map(h => { const it = byId[h.feedbackId];
        const li = el('li', { class: it ? 'is-link' : '' }, el('time', { text: fmtTime(h.at) }), el('b', { text: ACTION_TEXT(h) }), el('span', { class: 'aha-fb-by', text: h.by || '' }),
          el('div', { class: 'aha-fb-ctx', text: h.feedbackId + (it ? ' · ' + (it.sectionLabel || it.sectionId) + ' · ' + it.page : '') }),
          it ? el('p', { class: 'aha-fb-comment', text: it.comment.length > 140 ? it.comment.slice(0, 140) + '…' : it.comment }) : null,
          h.note ? el('p', { class: 'aha-fb-note', text: 'Ghi chú: ' + h.note }) : null);
        if (it) li.addEventListener('click', () => goToFeedback(it)); return li; })) : el('p', { class: 'aha-fb-empty', text: 'Chưa có thay đổi nào.' })));
  }
  async function goToFeedback(it) {
    const app = window.AhaKudosApp;
    if (it.page === 'kudos-detail' && currentPage() !== 'kudos-detail') { toast('Feedback này thuộc trang chi tiết KUDOS — mở một KUDOS để xem khu vực.'); openSection(it.sectionId); return; }
    if (app && it.page && it.page !== currentPage() && it.page !== 'unknown') app.go(it.page);
    let node = null;
    for (let i = 0; i < 30 && !node; i++) { await new Promise(r => setTimeout(r, 80)); tagSections(); node = document.querySelector('#app [data-feedback-id="' + CSS.escape(it.sectionId) + '"]'); }
    if (node) { const mobile = window.innerWidth <= 700; node.scrollIntoView({ behavior: document.visibilityState === 'visible' ? 'smooth' : 'auto', block: mobile ? 'start' : 'center' }); /* mobile: keep it above the bottom sheet */ node.classList.remove('fb-flash'); void node.offsetWidth; node.classList.add('fb-flash'); setTimeout(() => node.classList.remove('fb-flash'), 1800); }
    else toast('Không tìm thấy khu vực này trong kịch bản hiện tại.');
    openSection(it.sectionId, node);
  }

  /* ---------- 6. Wire-up ---------- */
  store.subscribe(() => { renderBar(); queueDraw(); if (!drawer.hidden && view) (view.kind === 'list' ? renderSidebar : renderSection)(); });
  // Scenario list comes from the boot payload (fetched once; read-only snapshot).
  fetch((JSON.parse(document.getElementById('ahakudos-config').textContent || '{}').basePath || '') + '/api/bridge', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'layTrangThai', args: [], scenario }) })
    .then(r => r.json()).then(j => { if (j && j.ok && j.data && j.data.review) fillScenarios(j.data.review.scenarios); }).catch(() => {});
  document.body.classList.add('fb-mode'); // review mode is always on for signed-in reviewers (toggle = this page view only)
  renderBar(); store.loadFeedback(); queueDraw();
  R.ui = Object.freeze({ openSection, openSidebar, setMode, refreshFeedbackIndicators: drawIndicators });
  }
})();
