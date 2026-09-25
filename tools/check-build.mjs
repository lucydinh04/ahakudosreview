// Vercel build gate (npm run build). Fails the deploy on any structural, syntax or safety regression.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';

const errors = [], notes = [];
const fail = m => errors.push(m);
const read = p => readFileSync(p, 'utf8');
const walk = d => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// 1. Required files
const REQUIRED = ['api/page.js', 'api/bridge.js', 'api/dev-login.js', 'api/health.js', 'api/background.js', 'api/avatar.js', 'api/feedback.js', 'api/review-login.js', 'lib/review-auth.js', 'private/review-login.html', 'public/review/review-login.js', 'lib/review-data.js', 'lib/review-snapshot.json', 'lib/feedback.js', 'lib/review-sandbox.js', 'public/review/review.css', 'public/review/feedback-sections.js', 'public/review/feedback-service.js', 'public/review/feedback-store.js', 'public/review/feedback-ui.js', 'lib/config.js', 'lib/http.js', 'lib/identity.js', 'lib/jwt.js', 'lib/bridge.js',
  'private/workspace.html', 'private/login.html', 'private/error.html', 'public/app/app.js', 'public/app/app.css', 'public/app/boot.js',
  'public/app/illustrations.js', 'public/app/dev-login.js', 'public/robots.txt'];
REQUIRED.forEach(p => { if (!existsSync(p)) fail('Missing ' + p); });
['api/auth.js', 'lib/security.js'].forEach(p => { if (existsSync(p)) fail('Legacy file must be removed: ' + p); });

// 2. Server modules: real syntax check with Node (ESM)
for (const f of [...walk('api'), ...walk('lib')].filter(f => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail('Syntax error in ' + f + ':\n' + r.stderr);
}
// 3. Browser scripts: classic-script syntax check + duplicate top-level declarations
for (const f of [...walk('public/app'), ...(existsSync('public/review') ? walk('public/review') : [])].filter(f => f.endsWith('.js'))) {
  const src = read(f);
  try { new vm.Script(src, { filename: f }); } catch (e) { fail('Browser JS syntax error in ' + f + ': ' + e.message); }
  const names = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1] || m[2]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) fail('Duplicate top-level declarations in ' + f + ': ' + [...new Set(dup)].join(', '));
  if (/google\.script\.run/.test(src)) fail(f + ': legacy google.script.run transport');
  if (/\[TEST/.test(src)) fail(f + ': "[TEST" copy must not ship');
  if (/data:image\/[a-z]+;base64,[A-Za-z0-9+/]{200}/.test(src)) fail(f + ': embedded base64 image (serve it from /public instead)');
}
const app = existsSync('public/app/app.js') ? read('public/app/app.js') : '';
for (const bad of ['demoRoleSwitcher', 'setCurrentUser', 'AHAKUDOS_TEST_BOOT', 'minhanh@ahamove.com', 'pc-admin@ahamove.com', 'personalEmailControls', 'openTestPanel', "rpc('henEmailThu'", "rpc('batEmail'"]) {
  if (app.includes(bad)) fail('public/app/app.js still contains demo/test code: ' + bad);
}
if (/\son(error|click|load|mouseover|focus)="/.test(app)) fail('Inline event handler attribute in app.js (blocked by CSP script-src \'self\')');

// 4. HTML templates: no inline executable script, placeholders known, no heavy inline assets
for (const f of walk('private').filter(f => f.endsWith('.html'))) {
  const html = read(f);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs) || /type="application\/json"/.test(attrs)) continue;
    fail(f + ': inline executable <script> is not allowed (CSP script-src \'self\')');
  }
  if (/\son[a-z]+=/i.test(html)) fail(f + ': inline event handler attribute');
  const unknown = [...html.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]).filter(n => !['BASE', 'BUILD', 'CONFIG_JSON', 'HANDBOOK_URL', 'TITLE', 'MESSAGE', 'REVIEW_ASSETS'].includes(n));
  if (unknown.length) fail(f + ': unknown placeholders ' + unknown.join(','));
  if (html.length > 20000) fail(f + ': template is ' + html.length + ' bytes (assets belong in /public)');
  if (/\[TEST|bản test|TEST_ACCESS_KEY/i.test(html)) fail(f + ': test copy');
}
// 5. Routing config
try {
  const vc = JSON.parse(read('vercel.json'));
  const src = (vc.rewrites || []).map(r => r.source);
  ['/', '/ahakudos', '/ahakudos/api/:path*'].forEach(s => { if (!src.includes(s)) fail('vercel.json missing rewrite ' + s); });
  if (!vc.functions || !vc.functions['api/page.js'] || vc.functions['api/page.js'].includeFiles !== 'private/**') fail('vercel.json: api/page.js must include private/**');
} catch (e) { fail('vercel.json invalid: ' + e.message); }
// 6. CSS: informational duplicate-selector count (visual parity kept on purpose)
if (existsSync('public/app/app.css')) {
  const css = read('public/app/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(s => s && !s.startsWith('@'));
  const counts = {}; sels.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  notes.push('CSS: ' + sels.length + ' rules, ' + Object.values(counts).filter(c => c > 1).length + ' selectors redefined (cascade order preserved).');
}

if (errors.length) { console.error('BUILD CHECK FAILED\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('AhaKudos build check OK (' + REQUIRED.length + ' required files, server + browser JS parsed, templates validated).');
notes.forEach(n => console.log('note: ' + n));
