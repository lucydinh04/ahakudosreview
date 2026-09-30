// AHAKUDOS standalone production server — for teams that self-host this folder instead of deploying it to Vercel
// (e.g. AhaHandbook serving https://handbook.ahamove.com/aha-kudos).
// It reproduces vercel.json exactly: the same API handlers, rewrites (/, /ahakudos, /aha-kudos, APP_BASE_PATH),
// static files from public/ and the same response headers. No dev/test shortcuts exist here.
//
//   npm run build                 # checks the bundle + writes private/build-id.txt (asset cache version)
//   PORT=3000 node server.mjs     # env vars: see SELF_HOST.md
//
// Requires Node.js 20+ (22 recommended).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 4.5 * 1024 * 1024; // same request limit as a Vercel function

if (process.env.ENABLE_DEV_IDENTITY === 'true' && String(process.env.AHA_ENV || '').toLowerCase() === 'production') {
  console.error('Refusing to start: ENABLE_DEV_IDENTITY=true is not allowed with AHA_ENV=production.');
  process.exit(1);
}

const api = {
  '/api/page': (await import('./api/page.js')).default,
  '/api/bridge': (await import('./api/bridge.js')).default,
  '/api/health': (await import('./api/health.js')).default,
  '/api/background': (await import('./api/background.js')).default,
  '/api/avatar': (await import('./api/avatar.js')).default,
  '/api/dev-login': (await import('./api/dev-login.js')).default,
  '/api/feedback': (await import('./api/feedback.js')).default,
  '/api/review-login': (await import('./api/review-login.js')).default
};

// Path prefixes the app answers under (vercel.json rewrites + APP_BASE_PATH).
const basePath = String(process.env.APP_BASE_PATH || '').replace(/\/+$/, '');
const PREFIXES = [...new Set([basePath, '/aha-kudos', '/ahakudos'].filter(Boolean))].sort((a, b) => b.length - a.length);

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

function baseHeaders(res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
/** Vercel-style response helpers used by the API handlers. */
function wrap(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
  res.send = body => { res.end(body); return res; };
  return res;
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') { try { return JSON.parse(text); } catch { return undefined; } }
  return text;
}
async function serveStatic(p, res) {
  const file = path.resolve(PUBLIC, '.' + decodeURIComponent(p));
  if (!file.startsWith(PUBLIC + path.sep)) return false; // no path traversal
  let st; try { st = await stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  if (/^\/app\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  else if (/^\/(backgrounds|illustrations|branding)\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.end(await readFile(file));
  return true;
}

http.createServer(async (req, res) => {
  baseHeaders(res); wrap(res);
  try {
    const url = new URL(req.url, 'http://internal');
    let p = url.pathname;
    for (const pre of PREFIXES) { if (p === pre || p.startsWith(pre + '/')) { p = p.slice(pre.length) || '/'; break; } }
    req.query = Object.fromEntries(url.searchParams);
    if (p === '/') p = '/api/page';
    const handler = api[p];
    if (handler) {
      if (req.method !== 'GET' && req.method !== 'HEAD') req.body = await readBody(req);
      return await handler(req, res);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && await serveStatic(p, res)) return;
    res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Not found');
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    res.statusCode = e && e.status === 413 ? 413 : 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, code: res.statusCode === 413 ? 'TOO_LARGE' : 'SERVER_ERROR', error: res.statusCode === 413 ? 'Nội dung yêu cầu quá lớn.' : 'Máy chủ AHAKUDOS gặp lỗi.' }));
    if (res.statusCode === 500) console.error('[ahakudos]', e);
  }
}).listen(PORT, HOST, () => console.log(`AHAKUDOS listening on http://${HOST}:${PORT}  (paths: /, ${PREFIXES.join(', ')})`));
