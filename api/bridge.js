// POST /api/bridge — the only data API. Identity is resolved server-side and signed into the envelope.
import { getConfig } from '../lib/config.js';
import { HttpError, noCache, fail, checkPost, bodyObject } from '../lib/http.js';
import { requireIdentity } from '../lib/identity.js';
import { callGoogle, METHODS, BROWSER_METHODS, UPLOAD_METHODS } from '../lib/bridge.js';
import { reviewCall } from '../lib/review-data.js';
import { requireReviewer } from '../lib/review-auth.js';
import { sandboxSend, sandboxList } from '../lib/review-sandbox.js';

export async function handle(req, res, deps = {}) {
  noCache(res);
  try {
    const config = getConfig();
    checkPost(req, config);
    if (config.review) {
      // REVIEW MODE: answered from the bundled snapshot. Mutations are refused here (server-side), never forwarded.
      const reviewer = requireReviewer(req, config);
      const rb = bodyObject(req, 80000);
      if (!BROWSER_METHODS.includes(rb.method) || !Array.isArray(rb.args) || rb.args.length !== METHODS[rb.method]) throw new HttpError(400, 'Thao tác không được cho phép.', 'METHOD_NOT_ALLOWED');
      // Sandbox send: stored in the review Apps Script; the email goes ONLY to the signed-in reviewer.
      if (rb.method === 'taoKudos') {
        const boot = reviewCall(config, 'layTrangThai', [], rb.scenario);
        return res.status(200).json({ ok: true, data: await sandboxSend(config, reviewer, boot, rb.args[0], rb.scenario, deps.fetchImpl) });
      }
      if (rb.method === 'xemKudos' && /^rv_[a-z0-9]{8,40}$/.test(String(rb.args[0] || ''))) {
        const own = (await sandboxList(config, reviewer, deps.fetchImpl)).find(k => k.id === rb.args[0]);
        if (!own) throw new HttpError(404, 'KUDOS không tồn tại hoặc bạn không có quyền xem.', 'KUDOS_NOT_AVAILABLE');
        return res.status(200).json({ ok: true, data: own });
      }
      const data = reviewCall(config, rb.method, rb.args, rb.scenario);
      if (rb.method === 'layTrangThai') {
        const mine = (await sandboxList(config, reviewer, deps.fetchImpl)).filter(k => k.reviewScenario === data.review.scenario);
        data.sent = mine.slice().reverse().concat(data.sent || []);
      }
      return res.status(200).json({ ok: true, data });
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
