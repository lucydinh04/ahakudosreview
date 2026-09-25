// GET /api/health — non-secret configuration check (does not call Google, returns no user data).
import { configSummary } from '../lib/config.js';
import { noCache } from '../lib/http.js';
export default function handler(req, res) {
  noCache(res);
  const s = configSummary();
  return res.status(s.ok ? 200 : 503).json(s);
}
