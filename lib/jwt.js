// Minimal, dependency-free verification of Keycloak-issued JWTs (RS256/RS384/RS512/PS256/ES256)
// against the realm JWKS. Used by the "oidc" identity adapter.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { HttpError } from './http.js';

const ALGS = {
  RS256: { hash: 'sha256' }, RS384: { hash: 'sha384' }, RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256', pss: true }, ES256: { hash: 'sha256', ec: true }
};
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 60 * 1000;
const cache = new Map(); // jwksUrl -> {keys: Map(kid -> KeyObject), fetchedAt}

function b64json(part) { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); }

async function loadJwks(url, fetchImpl, force) {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && !force && now - hit.fetchedAt < JWKS_TTL_MS) return hit;
  if (hit && force && now - hit.fetchedAt < JWKS_MIN_REFRESH_MS) return hit;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('JWKS HTTP ' + r.status);
    const body = await r.json();
    const keys = new Map();
    for (const jwk of Array.isArray(body.keys) ? body.keys : []) {
      if (!jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      try { keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })); } catch { /* unsupported key type: skip */ }
    }
    const entry = { keys, fetchedAt: now };
    cache.set(url, entry);
    return entry;
  } catch (e) {
    if (hit) return hit; // keep serving the last good key set if Keycloak is briefly unreachable
    throw new HttpError(503, 'Không tải được khoá xác thực của máy chủ đăng nhập.', 'IDP_UNAVAILABLE');
  } finally { clearTimeout(t); }
}

/**
 * Verifies signature + standard claims. Returns the payload.
 * opts: {issuer, audience, jwksUrl, clockSkewSec, fetchImpl, now}
 */
export async function verifyJwt(token, opts) {
  const bad = (why) => new HttpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang.', 'UNAUTHENTICATED', [why]);
  if (typeof token !== 'string' || token.length > 8192) throw bad('token_format');
  const parts = token.split('.');
  if (parts.length !== 3) throw bad('token_parts');
  let header, payload;
  try { header = b64json(parts[0]); payload = b64json(parts[1]); } catch { throw bad('token_json'); }
  const alg = ALGS[header.alg];
  if (!alg || !header.kid) throw bad('alg_or_kid');
  const fetchImpl = opts.fetchImpl || fetch;
  let jwks = await loadJwks(opts.jwksUrl, fetchImpl, false);
  let key = jwks.keys.get(header.kid);
  if (!key) { jwks = await loadJwks(opts.jwksUrl, fetchImpl, true); key = jwks.keys.get(header.kid); }
  if (!key) throw bad('unknown_kid');
  const data = Buffer.from(parts[0] + '.' + parts[1]);
  const sig = Buffer.from(parts[2], 'base64url');
  const keyOpts = alg.pss ? { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 } : alg.ec ? { key, dsaEncoding: 'ieee-p1363' } : key;
  let valid = false;
  try { valid = cryptoVerify(alg.hash, data, keyOpts, sig); } catch { valid = false; }
  if (!valid) throw bad('signature');
  const now = Math.floor((opts.now || Date.now()) / 1000), skew = opts.clockSkewSec || 60;
  if (payload.iss !== opts.issuer) throw bad('iss');
  if (!Number.isFinite(payload.exp) || payload.exp + skew < now) throw bad('exp');
  if (Number.isFinite(payload.nbf) && payload.nbf - skew > now) throw bad('nbf');
  if (Number.isFinite(payload.iat) && payload.iat - skew > now) throw bad('iat');
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!aud.includes(opts.audience) && payload.azp !== opts.audience) throw bad('aud');
  return payload;
}

export function _clearJwksCache() { cache.clear(); }
