// Signed channel from the REVIEW deployment to the separate "AHAKUDOS Review Feedback" Apps Script.
// It knows only three actions and a different secret (FEEDBACK_SECRET) than production — it cannot reach Code.gs.
import { createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

export const FEEDBACK_PREFIX = 'AHAKUDOS-FEEDBACK/V1\n';
export const FEEDBACK_ACTIONS = Object.freeze({ getReviewFeedback: 0, createReviewFeedback: 1, updateReviewFeedbackStatus: 4 });
export const FEEDBACK_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'DONE']);
const MAX_RESPONSE = 3000000;

export function signFeedback(config, action, args) {
  const payload = JSON.stringify({ v: 1, ts: Date.now(), nonce: randomBytes(16).toString('hex'), origin: config.appOrigin, action, args });
  const signature = createHmac('sha256', config.feedback.secret).update(FEEDBACK_PREFIX + payload).digest('hex');
  return { payload, signature };
}

export async function callFeedback(config, action, args, fetchImpl = fetch) {
  if (!config.review) throw new HttpError(404, 'Không tìm thấy.', 'NOT_FOUND');
  if (!config.feedback.url) throw new HttpError(503, 'Feedback chưa được cấu hình trên máy chủ (FEEDBACK_GAS_URL).', 'FEEDBACK_NOT_CONFIGURED');
  if (!Object.prototype.hasOwnProperty.call(FEEDBACK_ACTIONS, action) || !Array.isArray(args) || args.length !== FEEDBACK_ACTIONS[action]) throw new HttpError(400, 'Thao tác feedback không hợp lệ.', 'BAD_REQUEST');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    let response = await fetchImpl(config.feedback.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signFeedback(config, action, args)), redirect: 'manual', signal: controller.signal });
    if ([301, 302, 303].includes(response.status)) {
      const where = new URL(response.headers.get('location') || '', 'https://invalid.invalid');
      if (where.protocol !== 'https:' || where.hostname !== 'script.googleusercontent.com' || where.username || where.password) throw new HttpError(502, 'Google trả chuyển hướng không hợp lệ.', 'BACKEND_REDIRECT');
      response = await fetchImpl(where, { method: 'GET', redirect: 'error', signal: controller.signal });
    }
    if (!response.ok) throw new HttpError(502, 'Máy chủ feedback chưa phản hồi hợp lệ.', 'BACKEND_HTTP');
    const text = await response.text();
    if (text.length > MAX_RESPONSE) throw new HttpError(502, 'Phản hồi feedback quá lớn.', 'BACKEND_TOO_LARGE');
    let result;
    try { result = JSON.parse(text); } catch { throw new HttpError(502, 'Máy chủ feedback trả nội dung không phải JSON (kiểm tra quyền Web app).', 'BACKEND_INVALID_JSON'); }
    if (!result || typeof result.ok !== 'boolean') throw new HttpError(502, 'Phản hồi feedback không đúng định dạng.', 'BACKEND_INVALID_SHAPE');
    if (!result.ok) throw new HttpError(result.code === 'NOT_FOUND' ? 404 : 400, String(result.error || 'Không lưu được feedback.').slice(0, 300), String(result.code || 'FEEDBACK_ERROR'));
    return result.data;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new HttpError(504, 'Máy chủ feedback phản hồi quá lâu.', 'BACKEND_TIMEOUT');
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Chưa kết nối được máy chủ feedback.', 'BACKEND_UNREACHABLE');
  } finally { clearTimeout(timeout); }
}

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
/** Validates a feedback item from the browser. REVIEW_VERSION is always set by the server, never trusted from the client. */
export function cleanFeedbackItem(config, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const item = {
    reviewVersion: config.reviewVersion,
    page: clip(r.page, 40), sectionId: clip(r.sectionId, 60), sectionLabel: clip(r.sectionLabel, 120),
    elementText: clip(r.elementText, 300), author: clip(r.author, 80), comment: clip(r.comment, 2000)
  };
  if (!/^[a-z0-9-]{2,40}$/.test(item.page)) throw new HttpError(400, 'Trang không hợp lệ.', 'BAD_REQUEST');
  if (!/^[a-z0-9-]{2,60}$/.test(item.sectionId)) throw new HttpError(400, 'Mã khu vực không hợp lệ.', 'BAD_REQUEST');
  if (!item.author) throw new HttpError(400, 'Nhập tên người feedback.', 'VALIDATION');
  if (item.comment.length < 2) throw new HttpError(400, 'Nhập nội dung feedback.', 'VALIDATION');
  return item;
}
