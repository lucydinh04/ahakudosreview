// POST /api/dev-login — DEVELOPMENT/STAGING ONLY. Lets a tester act as an employee from DATA.
// Returns 404 whenever ENABLE_DEV_IDENTITY is off; getConfig() refuses dev identity when AHA_ENV=production.
import { getConfig } from '../lib/config.js';
import { HttpError, noCache, fail, checkPost, bodyObject } from '../lib/http.js';
import { checkDevKey, createDevCookie, clearDevCookie } from '../lib/identity.js';

export default async function handler(req, res) {
  noCache(res);
  try {
    const config = getConfig();
    if (!config.dev.enabled) throw new HttpError(404, 'Không tìm thấy.', 'NOT_FOUND');
    checkPost(req, config);
    const b = bodyObject(req, 2000);
    if (b.action === 'logout') { res.setHeader('Set-Cookie', clearDevCookie()); return res.status(200).json({ ok: true }); }
    const email = String(b.email || '').trim().toLowerCase();
    if (!checkDevKey(config, String(b.key || '').trim())) { await new Promise(r => setTimeout(r, 400)); throw new HttpError(401, 'DEV_ACCESS_KEY chưa đúng.', 'UNAUTHENTICATED'); }
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.split('@')[1] !== config.allowedDomain) throw new HttpError(400, 'Nhập email @' + config.allowedDomain + ' có trong tab DATA.', 'BAD_REQUEST');
    res.setHeader('Set-Cookie', createDevCookie(config, email));
    return res.status(200).json({ ok: true });
  } catch (e) { return fail(res, e); }
}
