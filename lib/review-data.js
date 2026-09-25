// REVIEW data adapter. In REVIEW_MODE the bridge answers from this snapshot instead of Apps Script.
// Read methods return snapshot data for the chosen scenario; mark-as-read calls are harmless no-ops;
// EVERY other method (send KUDOS, approve, email, upload, …) is refused here on the server — the review
// deployment has no production credentials, so there is nothing it could forward to anyway.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let SNAPSHOT = null;
function snapshot() {
  if (!SNAPSHOT) SNAPSHOT = JSON.parse(readFileSync(path.join(HERE, 'review-snapshot.json'), 'utf8'));
  return SNAPSHOT;
}
export const REVIEW_DISABLED_MESSAGE = 'Review Mode: thao tác này đã được disable.';
export const REVIEW_READ_METHODS = Object.freeze(['layTrangThai', 'xemKudos', 'layDuLieuAdmin', 'xemTruocEmail']);
export const REVIEW_NOOP_METHODS = Object.freeze(['ghiDaMo', 'docPhanHoi']);

const clone = o => JSON.parse(JSON.stringify(o));
const vnToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

export function reviewScenarioList() {
  return Object.values(snapshot().scenarios).map(s => ({ id: s.id, label: s.label, description: s.description }));
}
function scenario(id) {
  const all = snapshot().scenarios;
  return all[String(id || '')] || all.default;
}
function findRecord(s, id) {
  const lists = [s.boot.received, s.boot.sent, s.boot.community, (s.admin && s.admin.records) || []];
  for (const l of lists) { const k = (l || []).find(x => x.id === id); if (k) return clone(k); }
  return null;
}

/** Answers a bridge call in review mode. Never performs I/O besides reading the bundled snapshot. */
export function reviewCall(config, method, args, scenarioId) {
  const s = scenario(scenarioId);
  if (method === 'layTrangThai') {
    const boot = clone(s.boot);
    boot.review = { version: config.reviewVersion, scenario: s.id, scenarios: reviewScenarioList() };
    boot.config = Object.assign({}, boot.config, { env: 'review' });
    if (s.onboardToday && boot.me) { boot.me.onboardDate = vnToday(); boot.me.tenureDays = 0; }
    return boot;
  }
  if (method === 'xemKudos') {
    const k = findRecord(s, String(args[0] || ''));
    if (!k) throw new HttpError(404, 'KUDOS không tồn tại trong dữ liệu review.', 'KUDOS_NOT_AVAILABLE');
    return k;
  }
  if (method === 'layDuLieuAdmin') {
    if (!s.admin) throw new HttpError(403, 'Kịch bản review này không phải Admin. Chọn kịch bản "Admin".', 'FORBIDDEN');
    return clone(s.admin);
  }
  if (method === 'xemTruocEmail') {
    const p = s.emailPreviews && s.emailPreviews[String(args[0] || '')];
    if (!p) throw new HttpError(404, 'Không có bản xem trước email cho KUDOS này trong dữ liệu review.', 'NOT_FOUND');
    return clone(p);
  }
  if (REVIEW_NOOP_METHODS.includes(method)) {
    const k = findRecord(s, String(args[0] || ''));
    if (!k) throw new HttpError(404, 'KUDOS không tồn tại trong dữ liệu review.', 'KUDOS_NOT_AVAILABLE');
    if (method === 'ghiDaMo') k.viewedAt = k.viewedAt || new Date().toISOString();
    if (method === 'docPhanHoi') k.replyUnread = false;
    return k;
  }
  throw new HttpError(403, REVIEW_DISABLED_MESSAGE, 'REVIEW_DISABLED');
}
