// GET /api/avatar?email=<work email>&v=<version> — streams an employee's avatar to signed-in users.
// Files stay private in the Apps Script owner's Drive; the URL carries the version, so it can be cached.
import { getConfig } from '../lib/config.js';
import { HttpError, fail } from '../lib/http.js';
import { requireIdentity } from '../lib/identity.js';
import { callGoogle } from '../lib/bridge.js';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
export async function handle(req, res, deps = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Chỉ chấp nhận GET.', 'METHOD');
    const config = getConfig();
    const identity = await requireIdentity(req, config, deps);
    const url = new URL(req.url || '/', 'https://x.invalid');
    const q = k => String((req.query && req.query[k]) || url.searchParams.get(k) || '');
    const email = q('email').trim().toLowerCase(), v = q('v');
    if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,120}$/.test(email)) throw new HttpError(400, 'Email không hợp lệ.', 'BAD_REQUEST');
    if (v && !/^[a-z0-9]{1,16}$/.test(v)) throw new HttpError(400, 'Phiên bản ảnh không hợp lệ.', 'BAD_REQUEST');
    const data = await callGoogle(config, identity, 'layAnhDaiDien', [email], deps.fetchImpl);
    if (!data || !ALLOWED.includes(data.mime) || typeof data.b64 !== 'string') throw new HttpError(502, 'Ảnh không hợp lệ.', 'BACKEND_INVALID_SHAPE');
    const bytes = Buffer.from(data.b64, 'base64');
    res.setHeader('Content-Type', data.mime);
    res.setHeader('Content-Length', String(bytes.length));
    // Versioned URL (?v=) → safe to cache; a new upload gets a new version. Private because access requires sign-in.
    res.setHeader('Cache-Control', v && v === data.v ? 'private, max-age=2592000, immutable' : 'private, max-age=60');
    return res.status(200).send(req.method === 'HEAD' ? '' : bytes);
  } catch (e) {
    res.setHeader('Cache-Control', 'private, no-store');
    return fail(res, e);
  }
}
export default function handler(req, res) { return handle(req, res); }
