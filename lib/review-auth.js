// REVIEW deployment access: only emails in REVIEW_ALLOWED_EMAILS may open the review site, read its
// snapshot or write feedback. Sign-in = allowlisted work email (+ REVIEW_ACCESS_KEY only if configured) → signed, HttpOnly cookie.
// The allowlist is re-checked on every request, so removing an email revokes access immediately.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, header } from './http.js';

export const REVIEW_COOKIE = '__Host-ahakudos_review';
const TTL_SEC = 7 * 24 * 60 * 60;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const cookieKey = config => createHash('sha256').update('ahakudos-review-cookie\n' + config.reviewAccess.sessionSecret).digest();
const normEmail = e => String(e || '').trim().toLowerCase();

export function isDev(config, email) { return config.reviewAccess.devs.includes(normEmail(email)); }
/** Anyone allowed into the review site: reviewers + devs. */
export function isReviewer(config, email) { return config.reviewAccess.reviewers.includes(normEmail(email)) || isDev(config, email); }
export function checkAccessKey(config, key) { if (!config.reviewAccess.key) return true; /* email-only sign-in */ return same(createHash('sha256').update(String(key || '')).digest('hex'), createHash('sha256').update(config.reviewAccess.key).digest('hex')); }

export function createReviewCookie(config, email, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ e: normEmail(email), x: Math.floor(now / 1000) + TTL_SEC })).toString('base64url');
  const sig = createHmac('sha256', cookieKey(config)).update(payload).digest('base64url');
  return `${REVIEW_COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SEC}`;
}
export function clearReviewCookie() { return `${REVIEW_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

/** { email, source:'review' } for a valid, allowlisted reviewer cookie; otherwise null. */
export function getReviewer(req, config) {
  const raw = header(req, 'cookie').split(';').map(s => s.trim()).find(s => s.startsWith(REVIEW_COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(REVIEW_COOKIE.length + 1).split('.');
  if (!payload || !sig || !same(sig, createHmac('sha256', cookieKey(config)).update(payload).digest('base64url'))) return null;
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || typeof data.e !== 'string' || !(data.x > Date.now() / 1000)) return null;
  if (!isReviewer(config, data.e)) return null;
  return { email: data.e, source: 'review', role: isDev(config, data.e) ? 'dev' : 'reviewer' };
}
export function requireReviewer(req, config) {
  const r = getReviewer(req, config);
  if (!r) throw new HttpError(401, 'Vui lòng đăng nhập bản review bằng email được cấp quyền.', 'UNAUTHENTICATED');
  return r;
}
