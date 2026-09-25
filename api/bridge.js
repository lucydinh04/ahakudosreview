// POST /api/bridge — the only data API. Identity is resolved server-side and signed into the envelope.
import { getConfig } from '../lib/config.js';
import { HttpError, noCache, fail, checkPost, bodyObject } from '../lib/http.js';
import { requireIdentity } from '../lib/identity.js';
import { callGoogle, METHODS, BROWSER_METHODS, UPLOAD_METHODS } from '../lib/bridge.js';
import { reviewCall } from '../lib/review-data.js';
import { requireReviewer } from '../lib/review-auth.js';

export async function handle(req, res, deps = {}) {
  noCache(res);
  try {
    const config = getConfig();
    checkPost(req, config);
    if (config.review) {
      // REVIEW MODE: answered from the bundled snapshot. Mutations are refused here (server-side), never forwarded.
      requireReviewer(req, config);
      const rb = bodyObject(req, 80000);
      if (!BROWSER_METHODS.includes(rb.method) || !Array.isArray(rb.args) || rb.args.length !== METHODS[rb.method]) throw new HttpError(400, 'Thao tác không được cho phép.', 'METHOD_NOT_ALLOWED');
      return res.status(200).json({ ok: true, data: reviewCall(config, rb.method, rb.args, rb.scenario) });
    }
    const identity = await requireIdentity(req, config, deps);
    const b = bodyObject(req, 3500000);
    if (!UPLOAD_METHODS.includes(b.method) && Buffer.byteLength(JSON.stringify(b), 'utf8') > 80000) throw new HttpError(400, 'Nội dung yêu cầu quá dài.', 'BAD_REQUEST');
    if (!BROWSER_METHODS.includes(b.method) || !Object.prototype.hasOwnProperty.call(METHODS, b.method) || !Array.isArray(b.args) || b.args.length !== METHODS[b.method]) throw new HttpError(400, 'Thao tác không được cho phép.', 'METHOD_NOT_ALLOWED');
    const data = await callGoogle(config, identity, b.method, b.args, deps.fetchImpl);
    return res.status(200).json({ ok: true, data });
  } catch (e) { return fail(res, e); }
}
export default function handler(req, res) { return handle(req, res); }
