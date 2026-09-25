// GET /api/background?id=bg_xxx — streams an Admin-uploaded KUDOS background to signed-in users.
// Files stay private in the Apps Script owner's Drive; this endpoint is the only way to read them.
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
    const id = String((req.query && req.query.id) || url.searchParams.get('id') || '');
    if (!/^bg_[a-z0-9]{8,32}$/.test(id)) throw new HttpError(400, 'Mã background không hợp lệ.', 'BAD_REQUEST');
    const data = await callGoogle(config, identity, 'layAnhNen', [id], deps.fetchImpl);
    if (!data || !ALLOWED.includes(data.mime) || typeof data.b64 !== 'string') throw new HttpError(502, 'Ảnh không hợp lệ.', 'BACKEND_INVALID_SHAPE');
    const bytes = Buffer.from(data.b64, 'base64');
    res.setHeader('Content-Type', data.mime);
    res.setHeader('Content-Length', String(bytes.length));
    // Content for a given id never changes; private because access requires sign-in.
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    return res.status(200).send(req.method === 'HEAD' ? '' : bytes);
  } catch (e) {
    res.setHeader('Cache-Control', 'private, no-store');
    return fail(res, e);
  }
}
export default function handler(req, res) { return handle(req, res); }
