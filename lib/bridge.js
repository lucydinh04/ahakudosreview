// Signed Vercel → Google Apps Script bridge. METHODS must equal the API map in APPS_SCRIPT/Code.gs
// (tools/check-build.mjs fails the build if they drift apart).
import { createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

export const ENVELOPE_VERSION = 30;
export const ENVELOPE_PREFIX = 'AHAKUDOS/V30\n';
export const METHODS = Object.freeze({
  layTrangThai: 0, xemKudos: 1, taoKudos: 1, ghiDaMo: 1, doiReaction: 2,
  layDuLieuAdmin: 0, duyetKudos: 1, anKudos: 2, suaKudosDuyet: 2, datPhamViKudos: 2,
  guiEmailKudos: 2, xemTruocEmail: 1, datTuCam: 1, taiAnhNen: 1, doiTrangThaiAnhNen: 2, layAnhNen: 1,
  datAnhDaiDien: 1, xoaAnhDaiDien: 0, layAnhDaiDien: 1,
  datTagKudos: 2, chiaSeCongDong: 2, datLichGui: 1, huyLichGui: 1, guiPhanHoi: 2, docPhanHoi: 1
});
// Methods the browser may call through /api/bridge (image reads go through /api/background and /api/avatar).
export const BROWSER_METHODS = Object.freeze(Object.keys(METHODS).filter(m => m !== 'layAnhNen' && m !== 'layAnhDaiDien'));
export const UPLOAD_METHODS = Object.freeze(['taiAnhNen', 'datAnhDaiDien']);
const MAX_RESPONSE = 4200000;

export function signedEnvelope(config, identity, method, args) {
  const payload = JSON.stringify({
    v: ENVELOPE_VERSION, env: config.env, ts: Date.now(), nonce: randomBytes(16).toString('hex'), origin: config.appOrigin,
    actor: { email: identity.email, name: identity.name || '', source: identity.source }, method, args
  });
  const signature = createHmac('sha256', config.bridgeSecret).update(ENVELOPE_PREFIX + payload).digest('hex');
  return { payload, signature };
}

/** Calls Apps Script. Returns result.data or throws HttpError carrying the Apps Script error code. */
export async function callGoogle(config, identity, method, args, fetchImpl = fetch) {
  if (!Object.prototype.hasOwnProperty.call(METHODS, method) || !Array.isArray(args) || args.length !== METHODS[method]) throw new HttpError(400, 'Thao tác không được cho phép.', 'METHOD_NOT_ALLOWED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    let response = await fetchImpl(config.gasUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedEnvelope(config, identity, method, args)), redirect: 'manual', signal: controller.signal });
    if ([301, 302, 303].includes(response.status)) {
      // Apps Script ContentService answers with a redirect to script.googleusercontent.com. Follow only that host.
      const where = new URL(response.headers.get('location') || '', 'https://invalid.invalid');
      if (where.protocol !== 'https:' || where.hostname !== 'script.googleusercontent.com' || where.username || where.password) throw new HttpError(502, 'Google trả chuyển hướng không hợp lệ.', 'BACKEND_REDIRECT');
      response = await fetchImpl(where, { method: 'GET', redirect: 'error', signal: controller.signal });
    }
    if (!response.ok) throw new HttpError(502, 'Máy chủ Google chưa phản hồi hợp lệ.', 'BACKEND_HTTP');
    const text = await response.text();
    if (text.length > MAX_RESPONSE) throw new HttpError(502, 'Phản hồi Google vượt giới hạn.', 'BACKEND_TOO_LARGE');
    let result;
    try { result = JSON.parse(text); } catch { throw new HttpError(502, 'Google trả nội dung không phải JSON (kiểm tra quyền Web app).', 'BACKEND_INVALID_JSON'); }
    if (!result || typeof result.ok !== 'boolean') throw new HttpError(502, 'Phản hồi Google không đúng định dạng.', 'BACKEND_INVALID_SHAPE');
    if (!result.ok) {
      const code = String(result.code || 'ACTION_ERROR');
      const status = code === 'BRIDGE_REJECTED' ? 502 : code === 'FORBIDDEN' ? 403 : code === 'NOT_IN_MASTER_DATA' ? 403 : code === 'UNAUTHENTICATED' ? 401 : (code === 'KUDOS_NOT_AVAILABLE' || code === 'NOT_FOUND') ? 404 : code === 'BUSY' ? 503 : 400;
      throw new HttpError(status, String(result.error || 'Google từ chối thao tác.').slice(0, 700), code);
    }
    return result.data;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new HttpError(504, 'Google phản hồi quá lâu. Thao tác có thể đã được lưu — tải lại trang để kiểm tra trước khi thử lại.', 'BACKEND_TIMEOUT');
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Chưa kết nối được máy chủ Google.', 'BACKEND_UNREACHABLE');
  } finally { clearTimeout(timeout); }
}
