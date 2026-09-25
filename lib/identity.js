// Identity abstraction. The UI never decides who the user is.
//
//   getCurrentIdentity(req) -> {email, name, source}   (this file, Vercel)
//   getEmployeeByEmail / requireEmployee / requireAdmin  (Apps Script: getEmployeeByEmail_, requireEmployee_,
//                                                         requireAdmin_ — they need tabs DATA and ADMIN)
//
// Adapters (IDENTITY_MODE, comma separated, tried in order):
//   oidc           — verify the Keycloak token that the AhaHandbook proxy (oauth2-proxy) forwards
//                    (X-Forwarded-Access-Token / X-Auth-Request-Access-Token / Authorization: Bearer).
//                    Safe even if the Vercel URL is reachable directly: tokens cannot be forged.
//   trusted_header — email header set by the proxy, accepted ONLY together with TRUSTED_PROXY_SECRET.
//   dev            — signed cookie from /api/dev-login. Never available when AHA_ENV=production.
// To integrate a different identity provider, add an adapter here; nothing in the UI changes.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, header } from './http.js';
import { verifyJwt } from './jwt.js';

const DEV_COOKIE = '__Host-ahakudos_dev';
const DEV_TTL_SEC = 8 * 60 * 60;
const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;

function same(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function assertCompanyEmail(email, config) {
  if (!EMAIL_RE.test(email) || email.split('@')[1] !== config.allowedDomain) throw new HttpError(403, 'Chỉ tài khoản @' + config.allowedDomain + ' được sử dụng AHAKUDOS.', 'FORBIDDEN');
  return email;
}

const adapters = {
  async oidc(req, config, deps) {
    let token = '';
    for (const h of config.oidc.tokenHeaders) {
      const v = header(req, h).trim();
      if (!v) continue;
      token = h === 'authorization' ? (v.match(/^Bearer\s+(.+)$/i) || [])[1] || '' : v;
      if (token) break;
    }
    if (!token) return null;
    const claims = await verifyJwt(token, { ...config.oidc, fetchImpl: deps.fetchImpl });
    if (claims.email_verified === false) throw new HttpError(403, 'Email tài khoản chưa được xác minh.', 'FORBIDDEN');
    const email = assertCompanyEmail(normEmail(claims[config.oidc.emailClaim] || claims.email || claims.preferred_username), config);
    return { email, name: String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || '').slice(0, 120), source: 'oidc' };
  },
  async trusted_header(req, config) {
    const email = normEmail(header(req, config.trusted.emailHeader));
    if (!email) return null;
    const secret = header(req, config.trusted.secretHeader);
    if (!secret || !same(secret, config.trusted.secret)) throw new HttpError(401, 'Yêu cầu không đến từ proxy AhaHandbook.', 'UNAUTHENTICATED');
    return { email: assertCompanyEmail(email, config), name: '', source: 'trusted_header' };
  },
  async dev(req, config) {
    if (!config.dev.enabled) return null;
    const payload = readDevCookie(req, config);
    if (!payload) return null;
    return { email: assertCompanyEmail(payload.email, config), name: '', source: 'dev' };
  }
};

/** Resolves the caller. Returns null when no adapter found credentials; throws on invalid credentials. */
export async function getCurrentIdentity(req, config, deps = {}) {
  for (const mode of config.identityModes) {
    const adapter = adapters[mode];
    if (!adapter) continue;
    const identity = await adapter(req, config, deps);
    if (identity) return identity;
  }
  return null;
}

export async function requireIdentity(req, config, deps) {
  const id = await getCurrentIdentity(req, config, deps);
  if (!id) throw new HttpError(401, 'Vui lòng đăng nhập AhaHandbook để sử dụng AHAKUDOS.', 'UNAUTHENTICATED');
  return id;
}

/* ---- DEV identity (development / staging only) ---- */
function devMac(config, s) { return createHmac('sha256', config.dev.key).update('AHAKUDOS_DEV_IDENTITY\n' + s).digest('base64url'); }
export function createDevCookie(config, email) {
  const exp = Math.floor(Date.now() / 1000) + DEV_TTL_SEC;
  const p = Buffer.from(JSON.stringify({ email: normEmail(email), exp, env: config.env })).toString('base64url');
  return `${DEV_COOKIE}=${p}.${devMac(config, p)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DEV_TTL_SEC}`;
}
export function clearDevCookie() { return `${DEV_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function readDevCookie(req, config) {
  const c = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(DEV_COOKIE + '='));
  if (!c) return null;
  const [p, mac] = c.slice(DEV_COOKIE.length + 1).split('.');
  if (!p || !mac || !same(devMac(config, p), mac)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (d.env !== config.env || !Number.isSafeInteger(d.exp) || d.exp < Date.now() / 1000) return null;
    return d;
  } catch { return null; }
}
export function checkDevKey(config, key) { return config.dev.enabled && typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) && same(key, config.dev.key); }
