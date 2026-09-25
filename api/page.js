// GET / (and /ahakudos) — serves the app shell to an identified user, otherwise a sign-in notice
// (or the DEV sign-in page when ENABLE_DEV_IDENTITY=true outside production).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { getConfig } from '../lib/config.js';
import { noCache } from '../lib/http.js';
import { getCurrentIdentity } from '../lib/identity.js';
import { getReviewer } from '../lib/review-auth.js';

const templates = new Map();
const HERE = path.dirname(fileURLToPath(import.meta.url));
function privatePath(name) {
  const local = path.join(HERE, '..', 'private', name);
  return existsSync(local) ? local : path.join(process.cwd(), 'private', name);
}
async function template(name) {
  if (!templates.has(name)) templates.set(name, await readFile(privatePath(name), 'utf8'));
  return templates.get(name);
}
function escAttr(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function jsonForScript(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
export function securityHeaders(res, config) {
  const ancestors = ["'self'", config && config.handbookOrigin].filter(Boolean).join(' ');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:", "connect-src 'self'",
    "frame-src 'self' blob: data:", "base-uri 'self'", "object-src 'none'", `frame-ancestors ${ancestors}`, "form-action 'self'"
  ].join('; '));
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
export function render(tpl, config, extra = {}) {
  const base = config ? config.basePath : '';
  const build = config ? config.buildId : 'dev';
  const client = { basePath: base, env: config ? config.env : 'unknown', buildId: build, handbookUrl: config ? config.handbookOrigin : '', devIdentity: !!(config && config.dev.enabled) };
  if (config && config.review) client.review = { version: config.reviewVersion, feedback: !!config.feedback.enabled, reviewer: extra.reviewer || '', role: extra.role || '', needKey: !!config.reviewAccess.key };
  // Review layer assets are injected ONLY on the review deployment; production pages never load them.
  const reviewAssets = config && config.review
    ? ['<link rel="stylesheet" href="' + escAttr(base) + '/review/review.css?v=' + escAttr(build) + '">',
      ...['feedback-sections', 'feedback-service', 'feedback-store', 'feedback-ui'].map(f => '<script src="' + escAttr(base) + '/review/' + f + '.js?v=' + escAttr(build) + '"></script>')].join('\n  ')
    : '';
  return tpl.split('{{BASE}}').join(escAttr(base)).split('{{BUILD}}').join(escAttr(build))
    .split('{{HANDBOOK_URL}}').join(escAttr(client.handbookUrl || '#')).split('{{TITLE}}').join(escAttr(extra.title || 'AHAKUDOS'))
    .split('{{MESSAGE}}').join(escAttr(extra.message || '')).split('{{CONFIG_JSON}}').join(jsonForScript(client)).split('{{REVIEW_ASSETS}}').join(reviewAssets);
}
export async function handle(req, res, deps = {}) {
  noCache(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let config = null;
  try { config = getConfig(); } catch (e) {
    securityHeaders(res, null);
    console.error('[ahakudos] config', e.details || e.message);
    return res.status(503).send(render(await template('error.html'), null, { title: 'AHAKUDOS chưa sẵn sàng', message: 'Không thể kết nối AHAKUDOS. Vui lòng tải lại trang hoặc thử lại sau.' }));
  }
  securityHeaders(res, config);
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('');
  // REVIEW deployment: no sign-in; the review scenario (fictional data) decides who is shown.
  if (config.review) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const reviewer = getReviewer(req, config); // allowlisted reviewers only (REVIEW_ALLOWED_EMAILS)
    if (!reviewer) return res.status(200).send(render(await template('review-login.html'), config, { title: 'AHAKUDOS Review' }));
    return res.status(200).send(render(await template('workspace.html'), config, { title: 'AHAKUDOS Review', reviewer: reviewer.email, role: reviewer.role }));
  }
  let identity = null;
  try { identity = await getCurrentIdentity(req, config, deps); } catch (e) { identity = null; console.warn('[ahakudos] identity rejected', e.code, e.details || ''); }
  if (identity) return res.status(200).send(render(await template('workspace.html'), config));
  if (config.dev.enabled) return res.status(200).send(render(await template('login.html'), config));
  return res.status(401).send(render(await template('error.html'), config, { title: 'Vui lòng đăng nhập AhaHandbook', message: 'AHAKUDOS chỉ mở được sau khi bạn đăng nhập AhaHandbook bằng email @' + config.allowedDomain + '.' }));
}
export default function handler(req, res) { return handle(req, res); }
