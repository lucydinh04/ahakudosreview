/* AHAKUDOS Review — central feedback store. Components never fetch on their own; they read from here and
   subscribe to changes. If the API fails, a new feedback is kept in localStorage and clearly marked as NOT synced. */
(function () {
  'use strict';
  const R = window.AhaReview;
  const PENDING_KEY = 'ahakudos-review-pending';
  const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'];
  const listeners = new Set();
  const safeGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const safeSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const readPending = () => { try { const a = JSON.parse(safeGet(PENDING_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const writePending = list => safeSet(PENDING_KEY, list.length ? JSON.stringify(list) : null);

  const feedbackStore = {
    items: [], history: [], role: String((R.service.config || {}).role || 'reviewer'), pending: readPending(), currentVersion: String((R.service.config || {}).version || ''),
    currentSection: null, filter: 'OPEN', versionFilter: 'current', mine: false,
    loaded: false, loading: false, error: ''
  };
  const notify = () => listeners.forEach(fn => { try { fn(feedbackStore); } catch (e) { console.warn('[AHAKUDOS Review]', e); } });
  function norm(x) {
    return {
      id: String(x.id || ''), reviewVersion: String(x.reviewVersion || ''), page: String(x.page || ''), sectionId: String(x.sectionId || ''),
      sectionLabel: String(x.sectionLabel || ''), elementText: String(x.elementText || ''), author: String(x.author || ''), comment: String(x.comment || ''),
      status: STATUSES.includes(x.status) ? x.status : 'OPEN', createdAt: String(x.createdAt || ''), updatedAt: String(x.updatedAt || ''), local: !!x.local
    };
  }
  /** Everything the UI shows: synced items + not-yet-synced local ones. */
  function allItems() { return feedbackStore.items.concat(feedbackStore.pending.map(p => norm(Object.assign({}, p, { local: true })))); }
  const inScope = (x, allVersions) => allVersions || x.reviewVersion === feedbackStore.currentVersion;

  async function loadFeedback() {
    feedbackStore.loading = true; notify();
    try {
      const data = await R.service.list();
      if (data && data.version) feedbackStore.currentVersion = String(data.version);
      feedbackStore.items = ((data && data.items) || []).map(norm);
      feedbackStore.history = ((data && data.history) || []).slice();
      if (data && data.role) feedbackStore.role = String(data.role);
      feedbackStore.error = '';
    } catch (e) { feedbackStore.error = e.message || 'Không tải được feedback.'; }
    feedbackStore.loaded = true; feedbackStore.loading = false; notify();
    if (feedbackStore.pending.length) syncPending();
  }
  /** Creates a feedback. Resolves { item, synced }. On API failure keeps it locally (synced=false) — never pretends to sync. */
  async function createFeedback(input) {
    const item = { reviewVersion: feedbackStore.currentVersion, page: input.page, sectionId: input.sectionId, sectionLabel: input.sectionLabel,
      elementText: input.elementText, author: input.author, comment: input.comment };
    try {
      const saved = norm(await R.service.create(item));
      feedbackStore.items.push(saved);
      feedbackStore.history.push({ at: saved.createdAt, feedbackId: saved.id, action: 'CREATED', from: '', to: 'OPEN', by: saved.author, note: '' }); notify();
      return { item: saved, synced: true };
    } catch (e) {
      if (e.code === 'VALIDATION' || e.code === 'BAD_REQUEST' || e.code === 'RATE_LIMIT') throw e; // user can fix these — do not queue
      const local = Object.assign({}, item, { id: 'LOCAL-' + Date.now().toString(36), status: 'OPEN', createdAt: new Date().toISOString(), updatedAt: '', local: true, error: e.message });
      feedbackStore.pending.push(local); writePending(feedbackStore.pending); notify();
      return { item: norm(local), synced: false, error: e };
    }
  }
  async function syncPending() {
    if (!feedbackStore.pending.length) return { synced: 0, left: 0 };
    let synced = 0;
    for (const p of feedbackStore.pending.slice()) {
      try {
        const saved = norm(await R.service.create({ reviewVersion: p.reviewVersion, page: p.page, sectionId: p.sectionId, sectionLabel: p.sectionLabel, elementText: p.elementText, author: p.author, comment: p.comment }));
        feedbackStore.items.push(saved);
        feedbackStore.pending = feedbackStore.pending.filter(x => x.id !== p.id); synced++;
      } catch (e) { break; }
    }
    writePending(feedbackStore.pending); notify();
    return { synced, left: feedbackStore.pending.length };
  }
  /** Optimistic status change; reverts and rethrows if the API refuses. */
  async function updateFeedbackStatus(id, status, by, note) {
    if (!STATUSES.includes(status)) throw new Error('Trạng thái không hợp lệ.');
    const local = feedbackStore.pending.find(x => x.id === id);
    if (local) { local.status = status; writePending(feedbackStore.pending); notify(); return; }
    const it = feedbackStore.items.find(x => x.id === id); if (!it) return;
    const prev = { status: it.status, updatedAt: it.updatedAt };
    it.status = status; it.updatedAt = new Date().toISOString(); notify();
    try {
      const saved = await R.service.setStatus(id, status, note || ''); if (saved) Object.assign(it, norm(saved));
      feedbackStore.history.push({ at: it.updatedAt, feedbackId: id, action: prev.status === 'DONE' && status === 'OPEN' ? 'REOPENED' : 'STATUS', from: prev.status, to: status, by: by || '', note: note || '' }); notify();
    }
    catch (e) { Object.assign(it, prev); notify(); throw e; }
  }
  function getFeedbackForSection(sectionId, opts) {
    const all = !!(opts && opts.allVersions);
    return allItems().filter(x => x.sectionId === sectionId && inScope(x, all)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  /** { open, inProgress, done, unresolved, state } for the CURRENT review version (drives the "!" indicator). */
  function getSectionFeedbackState(sectionId) {
    const list = getFeedbackForSection(sectionId);
    const open = list.filter(x => x.status === 'OPEN').length, inProgress = list.filter(x => x.status === 'IN_PROGRESS').length, done = list.filter(x => x.status === 'DONE').length;
    const unresolved = open + inProgress;
    return { open, inProgress, done, unresolved, state: unresolved === 0 ? 'NONE' : open > 0 ? 'OPEN' : 'IN_PROGRESS' };
  }
  function getUnresolvedCount() { return allItems().filter(x => inScope(x, false) && x.status !== 'DONE').length; }
  function filteredItems() {
    const author = String((R.service.config || {}).reviewer || safeGet('reviewFeedbackAuthor') || '').trim().toLowerCase();
    return allItems().filter(x => inScope(x, feedbackStore.versionFilter === 'all'))
      .filter(x => feedbackStore.filter === 'ALL' || feedbackStore.filter === 'HISTORY' || x.status === feedbackStore.filter)
      .filter(x => !feedbackStore.mine || (author && x.author.trim().toLowerCase() === author))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  /** Change history for one feedback (oldest first) and across all visible feedback (newest first). */
  const historyFor = id => feedbackStore.history.filter(h => h.feedbackId === id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const recentHistory = () => feedbackStore.history.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  R.store = Object.freeze({
    historyFor, recentHistory, isDev: () => feedbackStore.role === 'dev',
    state: feedbackStore, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, notify,
    loadFeedback, createFeedback, syncPending, updateFeedbackStatus, getFeedbackForSection, getSectionFeedbackState, getUnresolvedCount, filteredItems,
    setFilter(f) { feedbackStore.filter = f; notify(); }, setVersionFilter(v) { feedbackStore.versionFilter = v; notify(); }, setMine(m) { feedbackStore.mine = !!m; notify(); }
  });
})();
