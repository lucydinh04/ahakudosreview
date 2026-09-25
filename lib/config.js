// Single source of runtime configuration for the Vercel layer. Every value comes from environment
// variables; nothing environment-specific is hard-coded elsewhere. See docs/README_DEPLOY.md.
import { HttpError } from './http.js';

const ENVS = ['development', 'staging', 'production'];
const HEX64 = /^[a-f0-9]{64}$/;

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v).trim();
}
function httpsOrigin(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return '';
    return u.origin;
  } catch { return ''; }
}

/** Default review round shown in the Review Bar. Bump per review round (or set env REVIEW_VERSION). Feedback is never deleted. */
export const REVIEW_VERSION = 'V30.19-review-01';
/** Who may open the review site (override with env REVIEW_ALLOWED_EMAILS, comma separated). */
export const REVIEW_ALLOWED_EMAILS = ['trangdlh@ahamove.com', 'nint@ahamove.com', 'binhnt@ahamove.com'];
/** Dev accounts: see ALL feedback, change status, see full history (override with env REVIEW_DEV_EMAILS). */
export const REVIEW_DEV_EMAILS = ['nhidvm@ahamove.com'];
const FEEDBACK_URL_RE = /^https:\/\/script\.google\.com\/(?:macros\/s\/|a\/macros\/[A-Za-z0-9.-]+\/s\/)[A-Za-z0-9_-]+\/exec$/;

/* REVIEW / STAGING deployment (separate Vercel project, same code). It serves a snapshot of the UI and only writes feedback.
   It must NEVER hold production credentials, so the bridge physically cannot reach production Apps Script. */
function getReviewConfig() {
  const problems = [];
  const env = str('AHA_ENV', 'review').toLowerCase();
  if (env !== 'review') problems.push('REVIEW_MODE=true cần AHA_ENV=review.');
  if (str('DISABLE_PRODUCTION_MUTATIONS', 'true') !== 'true') problems.push('Review Mode luôn chặn mutation production (DISABLE_PRODUCTION_MUTATIONS phải là true).');
  if (str('GAS_EXEC_URL') || str('GAS_BRIDGE_SECRET')) problems.push('Review deployment KHÔNG được chứa GAS_EXEC_URL / GAS_BRIDGE_SECRET của production. Xoá 2 biến này khỏi project review.');
  if (str('TRUSTED_PROXY_SECRET') || str('DEV_ACCESS_KEY')) problems.push('Review deployment không dùng TRUSTED_PROXY_SECRET / DEV_ACCESS_KEY.');
  const appOrigin = httpsOrigin(str('APP_ORIGIN').replace(/\/+$/, '') + '/');
  if (!appOrigin) problems.push('APP_ORIGIN phải là origin HTTPS của bản review, ví dụ https://ahakudos-review.vercel.app');
  const basePath = str('APP_BASE_PATH').replace(/\/+$/, '');
  if (basePath && !/^(\/[a-z0-9][a-z0-9-]*)+$/.test(basePath)) problems.push('APP_BASE_PATH không hợp lệ.');
  const version = str('REVIEW_VERSION', REVIEW_VERSION);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(version)) problems.push('REVIEW_VERSION chỉ gồm chữ, số, . _ - (3–40 ký tự).');
  const feedbackUrl = str('FEEDBACK_GAS_URL'), feedbackSecret = str('FEEDBACK_SECRET');
  const feedbackEnabled = str('ENABLE_FEEDBACK', 'true') === 'true';
  if (feedbackUrl && !FEEDBACK_URL_RE.test(feedbackUrl)) problems.push('FEEDBACK_GAS_URL phải là Web app URL của Apps Script Review Feedback (kết thúc bằng /exec).');
  if (feedbackUrl && !HEX64.test(feedbackSecret)) problems.push('FEEDBACK_SECRET cần đúng 64 ký tự hex (lấy từ khoiTaoFeedback()).');
  const reviewers = str('REVIEW_ALLOWED_EMAILS', REVIEW_ALLOWED_EMAILS.join(',')).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!reviewers.length || reviewers.some(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) problems.push('REVIEW_ALLOWED_EMAILS phải là danh sách email, cách nhau bằng dấu phẩy.');
  const devs = str('REVIEW_DEV_EMAILS', REVIEW_DEV_EMAILS.join(',')).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (devs.some(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) problems.push('REVIEW_DEV_EMAILS phải là danh sách email, cách nhau bằng dấu phẩy.');
  // Sign-in = email in REVIEW_ALLOWED_EMAILS. REVIEW_ACCESS_KEY is OPTIONAL: when set, the shared code is also required.
  const accessKey = str('REVIEW_ACCESS_KEY');
  if (accessKey && accessKey.length < 12) problems.push('REVIEW_ACCESS_KEY (nếu dùng) cần ít nhất 12 ký tự.');
  if (accessKey && accessKey === feedbackSecret) problems.push('REVIEW_ACCESS_KEY phải khác FEEDBACK_SECRET.');
  // Server-side secret that signs the reviewer session cookie (never sent to the browser).
  const sessionSecret = str('REVIEW_SESSION_SECRET') || feedbackSecret || accessKey;
  if (sessionSecret.length < 32) problems.push('Cần REVIEW_SESSION_SECRET (64 hex) hoặc FEEDBACK_SECRET để ký phiên đăng nhập review.');
  if (problems.length) throw new HttpError(503, 'Cấu hình AHAKUDOS Review chưa hợp lệ.', 'CONFIG', problems);
  return Object.freeze({
    env: 'review', review: true, reviewVersion: version, disableMutations: true,
    appOrigin, basePath, handbookOrigin: httpsOrigin(str('HANDBOOK_ORIGIN', 'https://handbook.ahamove.com').replace(/\/+$/, '') + '/'),
    gasUrl: '', bridgeSecret: '', allowedDomain: 'ahamove.com', identityModes: [], dev: { enabled: false, key: '' },
    oidc: { tokenHeaders: [] }, trusted: {},
    feedback: { enabled: feedbackEnabled, url: feedbackEnabled ? feedbackUrl : '', secret: feedbackEnabled ? feedbackSecret : '' },
    reviewAccess: { reviewers, devs, key: accessKey, sessionSecret },
    buildId: (str('VERCEL_GIT_COMMIT_SHA') || str('BUILD_ID') || 'dev').slice(0, 12)
  });
}

/** Reads and validates configuration. Throws HttpError(503) on any unsafe or missing value (fail closed). */
export function getConfig() {
  if (str('REVIEW_MODE') === 'true') return getReviewConfig();
  const problems = [];
  const vercelEnv = str('VERCEL_ENV');
  let env = str('AHA_ENV').toLowerCase();
  if (!env) env = vercelEnv === 'production' ? '' : 'development';
  if (!ENVS.includes(env)) problems.push('AHA_ENV phải là development | staging | production.');

  const appOrigin = httpsOrigin(str('APP_ORIGIN').replace(/\/+$/, '') + '/');
  if (!appOrigin) problems.push('APP_ORIGIN phải là origin HTTPS, ví dụ https://handbook.ahamove.com');

  const basePath = str('APP_BASE_PATH').replace(/\/+$/, '');
  if (basePath && !/^(\/[a-z0-9][a-z0-9-]*)+$/.test(basePath)) problems.push('APP_BASE_PATH không hợp lệ (ví dụ /ahakudos).');

  const handbookOrigin = httpsOrigin(str('HANDBOOK_ORIGIN', 'https://handbook.ahamove.com').replace(/\/+$/, '') + '/');

  const gasUrl = str('GAS_EXEC_URL');
  if (!/^https:\/\/script\.google\.com\/(?:macros\/s\/|a\/macros\/[A-Za-z0-9.-]+\/s\/)[A-Za-z0-9_-]+\/exec$/.test(gasUrl)) problems.push('GAS_EXEC_URL phải là Web app URL Apps Script kết thúc bằng /exec.');
  const bridgeSecret = str('GAS_BRIDGE_SECRET');
  if (!HEX64.test(bridgeSecret)) problems.push('GAS_BRIDGE_SECRET cần đúng 64 ký tự hex.');

  const identityModes = str('IDENTITY_MODE', env === 'production' ? 'oidc' : 'oidc').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const devEnabled = str('ENABLE_DEV_IDENTITY', 'false') === 'true';
  const devKey = str('DEV_ACCESS_KEY');
  if (identityModes.some(m => !['oidc', 'trusted_header', 'dev'].includes(m))) problems.push('IDENTITY_MODE chỉ gồm oidc, trusted_header, dev.');
  if (env === 'production' && (devEnabled || identityModes.includes('dev'))) problems.push('Production KHÔNG được bật ENABLE_DEV_IDENTITY hoặc IDENTITY_MODE=dev.');
  if (identityModes.includes('dev') && (!devEnabled || !HEX64.test(devKey))) problems.push('IDENTITY_MODE=dev cần ENABLE_DEV_IDENTITY=true và DEV_ACCESS_KEY (64 hex).');
  if (devKey && devKey === bridgeSecret) problems.push('DEV_ACCESS_KEY phải khác GAS_BRIDGE_SECRET.');

  const issuer = str('OIDC_ISSUER', 'https://auth.ahamove.com/realms/hr').replace(/\/+$/, '');
  const trustedSecret = str('TRUSTED_PROXY_SECRET');
  if (identityModes.includes('trusted_header') && !HEX64.test(trustedSecret)) problems.push('IDENTITY_MODE=trusted_header cần TRUSTED_PROXY_SECRET (64 hex) do proxy AhaHandbook gửi kèm.');

  if (problems.length) throw new HttpError(503, 'Cấu hình AHAKUDOS chưa hợp lệ.', 'CONFIG', problems);

  return Object.freeze({
    env, appOrigin, basePath, handbookOrigin, gasUrl, bridgeSecret,
    allowedDomain: str('ALLOWED_EMAIL_DOMAIN', 'ahamove.com').toLowerCase(),
    identityModes,
    dev: { enabled: devEnabled && env !== 'production', key: devKey },
    oidc: {
      issuer,
      jwksUrl: str('OIDC_JWKS_URL', issuer + '/protocol/openid-connect/certs'),
      audience: str('OIDC_AUDIENCE', 'handbook'),
      tokenHeaders: str('OIDC_TOKEN_HEADERS', 'x-forwarded-access-token,x-auth-request-access-token,authorization').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
      emailClaim: str('OIDC_EMAIL_CLAIM', 'email'),
      clockSkewSec: Number(str('OIDC_CLOCK_SKEW_SEC', '60')) || 60
    },
    trusted: {
      emailHeader: str('TRUSTED_EMAIL_HEADER', 'x-auth-request-email').toLowerCase(),
      secretHeader: str('TRUSTED_PROXY_SECRET_HEADER', 'x-ahakudos-proxy-secret').toLowerCase(),
      secret: trustedSecret
    },
    buildId: (str('VERCEL_GIT_COMMIT_SHA') || str('BUILD_ID') || 'dev').slice(0, 12)
  });
}

/** Non-secret summary for /api/health. */
export function configSummary() {
  try {
    const c = getConfig();
    if (c.review) return { ok: true, env: 'review', reviewVersion: c.reviewVersion, feedback: c.feedback.url ? 'configured' : 'local-only', productionMutations: 'disabled', reviewers: c.reviewAccess.reviewers.length, devs: c.reviewAccess.devs.length, basePath: c.basePath || '/', buildId: c.buildId };
    return { ok: true, env: c.env, identityModes: c.identityModes, basePath: c.basePath || '/', devIdentity: c.dev.enabled, buildId: c.buildId };
  } catch (e) {
    return { ok: false, problems: e.details || [e.message] };
  }
}
