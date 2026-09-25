// /api/feedback — REVIEW deployment only. GET lists feedback; POST creates feedback or changes its status.
// Talks only to the separate Review Feedback Apps Script (tab WEB_FEEDBACK). 404 on production deployments.
import { getConfig } from '../lib/config.js';
import { HttpError, noCache, fail, checkPost, bodyObject, header } from '../lib/http.js';
import { callFeedback, cleanFeedbackItem, FEEDBACK_STATUSES } from '../lib/feedback.js';
import { requireReviewer } from '../lib/review-auth.js';

const hits = new Map(); // best-effort per-instance rate limit for writes
function rateLimit(req) {
  const ip = header(req, 'x-forwarded-for').split(',')[0].trim() || 'local';
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (list.length >= 60) throw new HttpError(429, 'Bạn gửi feedback hơi nhanh, thử lại sau ít phút nhé.', 'RATE_LIMIT');
  list.push(now); hits.set(ip, list);
}
export async function handle(req, res, deps = {}) {
  noCache(res);
  try {
    const config = getConfig();
    if (!config.review) throw new HttpError(404, 'Không tìm thấy.', 'NOT_FOUND');
    const reviewer = requireReviewer(req, config);
    if (req.method === 'GET') {
      const data = await callFeedback(config, 'getReviewFeedback', [], deps.fetchImpl);
      // Dev sees everything; a reviewer sees only their own feedback (and its history).
      let items = (data && data.items) || [], history = (data && data.history) || [];
      if (reviewer.role !== 'dev') {
        items = items.filter(x => String(x.author || '').toLowerCase() === reviewer.email);
        const mine = new Set(items.map(x => x.id)); history = history.filter(h => mine.has(h.feedbackId));
      }
      return res.status(200).json({ ok: true, data: { version: config.reviewVersion, role: reviewer.role, items, history } });
    }
    checkPost(req, config);
    rateLimit(req);
    const b = bodyObject(req, 20000);
    if (b.action === 'create') {
      const item = cleanFeedbackItem(config, Object.assign({}, b.item, { author: reviewer.email })); // author = signed-in reviewer, never typed
      const data = await callFeedback(config, 'createReviewFeedback', [item], deps.fetchImpl);
      return res.status(200).json({ ok: true, data });
    }
    if (b.action === 'status') {
      if (reviewer.role !== 'dev') throw new HttpError(403, 'Chỉ dev mới đổi được trạng thái feedback.', 'FORBIDDEN');
      const id = String(b.id || ''), status = String(b.status || '');
      if (!/^FB-\d{8}-\d{4}$/.test(id) || !FEEDBACK_STATUSES.includes(status)) throw new HttpError(400, 'Trạng thái feedback không hợp lệ.', 'BAD_REQUEST');
      const data = await callFeedback(config, 'updateReviewFeedbackStatus', [id, status, reviewer.email, String(b.note || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000)], deps.fetchImpl);
      return res.status(200).json({ ok: true, data });
    }
    throw new HttpError(400, 'Thao tác feedback không hợp lệ.', 'BAD_REQUEST');
  } catch (e) { return fail(res, e); }
}
export default function handler(req, res) { return handle(req, res); }
