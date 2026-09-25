// POST /api/review-login — REVIEW deployment only. {action:'login', email[, key]} or {action:'logout'}.
// Accepts only emails in REVIEW_ALLOWED_EMAILS (and REVIEW_ACCESS_KEY only if it is configured).
// One generic error message, so the allowlist cannot be probed; 10 attempts / 10 min / IP.
import { getConfig } from '../lib/config.js';
import { HttpError, noCache, fail, checkPost, bodyObject, header } from '../lib/http.js';
import { isReviewer, checkAccessKey, createReviewCookie, clearReviewCookie } from '../lib/review-auth.js';

const attempts = new Map();
function limit(req) {
  const ip = header(req, 'x-forwarded-for').split(',')[0].trim() || 'local';
  const now = Date.now(), list = (attempts.get(ip) || []).filter(t => now - t < 600000);
  if (list.length >= 10) throw new HttpError(429, 'Thử quá nhiều lần. Vui lòng đợi 10 phút.', 'RATE_LIMIT');
  list.push(now); attempts.set(ip, list);
}
export async function handle(req, res) {
  noCache(res);
  try {
    const config = getConfig();
    if (!config.review) throw new HttpError(404, 'Không tìm thấy.', 'NOT_FOUND');
    checkPost(req, config);
    const b = bodyObject(req, 2000);
    if (b.action === 'logout') { res.setHeader('Set-Cookie', clearReviewCookie()); return res.status(200).json({ ok: true, data: {} }); }
    if (b.action !== 'login') throw new HttpError(400, 'Thao tác không hợp lệ.', 'BAD_REQUEST');
    limit(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!checkAccessKey(config, b.key) || !isReviewer(config, email)) throw new HttpError(401, config.reviewAccess.key ? 'Email hoặc mã truy cập chưa đúng, hoặc email chưa được cấp quyền review.' : 'Email này chưa được cấp quyền vào bản review.', 'UNAUTHENTICATED');
    res.setHeader('Set-Cookie', createReviewCookie(config, email));
    return res.status(200).json({ ok: true, data: { email } });
  } catch (e) { return fail(res, e); }
}
export default function handler(req, res) { return handle(req, res); }
