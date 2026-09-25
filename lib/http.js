// HTTP helpers shared by every function: errors, headers, request validation.
export class HttpError extends Error {
  constructor(status, message, code = '', details = null) {
    super(message);
    this.status = status;
    this.code = code || (status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'ERROR');
    this.details = details;
  }
}

export function noCache(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

export function fail(res, e) {
  const status = e instanceof HttpError ? e.status : 500;
  if (!(e instanceof HttpError) || status >= 500) console.error('[ahakudos]', e && (e.stack || e.message || e), e && e.details ? e.details : '');
  const body = { ok: false, code: e instanceof HttpError ? e.code : 'ERROR', error: e instanceof HttpError ? e.message : 'Có lỗi xử lý. Vui lòng thử lại sau.' };
  return res.status(status).json(body);
}

/** POST + same-origin (Origin header must equal APP_ORIGIN) + JSON body. */
export function checkPost(req, config) {
  if (req.method !== 'POST') throw new HttpError(405, 'Chỉ chấp nhận POST.', 'METHOD');
  if (String(req.headers.origin || '') !== config.appOrigin) throw new HttpError(403, 'Nguồn yêu cầu không được phép.', 'ORIGIN');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/json') throw new HttpError(415, 'Yêu cầu phải là JSON.', 'CONTENT_TYPE');
}

export function bodyObject(req, limit = 80000) {
  const b = req.body;
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(b), 'utf8'); } catch { size = Infinity; }
  if (!b || typeof b !== 'object' || Array.isArray(b) || size > limit) throw new HttpError(400, 'Nội dung yêu cầu không hợp lệ hoặc quá dài.', 'BAD_REQUEST');
  return b;
}

export function header(req, name) {
  const v = req.headers[String(name).toLowerCase()];
  return Array.isArray(v) ? String(v[0] || '') : String(v || '');
}
