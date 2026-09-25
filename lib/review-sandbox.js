// REVIEW sandbox send: a reviewer can send a KUDOS to try the whole flow. Nothing reaches production:
// the record is stored in the review Apps Script (tab REVIEW_KUDOS) and the notification email goes ONLY to the
// signed-in reviewer's own address — never to the recipient chosen in the form.
import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { callFeedback } from './feedback.js';

const VALUES = ['speed', 'together', 'innovation'];
const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const vnLabel = d => { const x = new Date(d.getTime() + 7 * 3600000); const p = n => String(n).padStart(2, '0'); return p(x.getUTCDate()) + '/' + p(x.getUTCMonth() + 1) + ' ' + p(x.getUTCHours()) + ':' + p(x.getUTCMinutes()); };

/** Builds the sandbox record in the same shape the app renders for a sent KUDOS. */
export function buildSandboxRecord(boot, payload, scenarioId) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const message = clip(p.message, 6000);
  if (message.length < 15) throw new HttpError(400, 'Nội dung KUDOS cần từ 15 đến 6.000 ký tự.', 'VALIDATION');
  const values = Array.isArray(p.values) ? [...new Set(p.values.map(String))] : [];
  if (values.length > 3 || values.some(v => !VALUES.includes(v))) throw new HttpError(400, 'Chọn tối đa 3 Giá trị cốt lõi hợp lệ.', 'VALIDATION');
  const templateId = clip(p.templateId, 40);
  if (!/^[a-z0-9_]{2,40}$/.test(templateId)) throw new HttpError(400, 'Chọn một background hợp lệ.', 'VALIDATION');
  const recipientEmail = clip(p.recipientEmail, 120).toLowerCase();
  if (!EMAIL_RE.test(recipientEmail)) throw new HttpError(400, 'Chọn người nhận hợp lệ.', 'VALIDATION');
  const admin = p.type === 'admin';
  const me = boot.me || {};
  if (!admin && recipientEmail === String(me.email || '').toLowerCase()) throw new HttpError(400, 'Không tự gửi KUDOS cho chính mình.', 'VALIDATION');
  const person = (boot.people || []).find(x => x.email === recipientEmail);
  const now = new Date();
  return {
    id: 'rv_' + randomBytes(10).toString('hex'), createdAt: now.toISOString(), sentAtLabel: vnLabel(now), source: admin ? 'ADMIN' : 'EMPLOYEE',
    senderName: admin ? 'AHAKUDOS' : String(me.name || ''), senderDept: admin ? 'Ahamove' : String(me.dept || ''), senderSection: admin ? '' : String(me.section || ''), senderEmail: admin ? '' : String(me.email || ''),
    recipientName: person ? person.name : clip(p.recipientName, 120) || recipientEmail, recipientDept: person ? person.dept : clip(p.recipientDept, 120), recipientSection: person ? person.section : '',
    recipientEmail, recipientManual: !person, message, values, templateId,
    kudosType: ['recognition', 'birthday', 'anniversary', 'custom'].includes(p.kudosType) ? p.kudosType : 'recognition', occasionLabel: clip(p.occasionLabel, 60),
    visibility: admin && p.visibility === 'private' ? 'private' : 'public', publicConsent: 'pending', moderationStatus: 'HELD', isCommunity: false,
    reactions: { heart: 0, clap: 0, cheer: 0, spark: 0 }, myReactions: {}, viewedAt: null, emailStatus: 'SENT', replies: [], canReply: false,
    review: true, reviewScenario: String(scenarioId || 'default').slice(0, 30)
  };
}
export async function sandboxSend(config, reviewer, boot, payload, scenarioId, fetchImpl) {
  const record = buildSandboxRecord(boot, payload, scenarioId);
  const link = config.appOrigin + (config.basePath || '') + '/#/k/' + record.id;
  const r = await callFeedback(config, 'createReviewKudos', [record, reviewer.email, link], fetchImpl);
  const ok = String(r && r.emailStatus || '') === 'SENT';
  record.emailStatus = ok ? 'SENT' : 'FAILED';
  return {
    record, quota: boot.quota || null,
    notice: ok ? 'Bản review: email thông báo đã được gửi tới ' + reviewer.email + ' để bạn trải nghiệm. Người nhận thật không nhận được email.'
      : 'Bản review: KUDOS đã lưu nhưng chưa gửi được email thử nghiệm tới ' + reviewer.email + '.'
  };
}
/** The reviewer's own sandbox KUDOS (never anyone else's). Returns [] if the feedback backend is not configured/unreachable. */
export async function sandboxList(config, reviewer, fetchImpl) {
  try { const d = await callFeedback(config, 'getReviewKudos', [reviewer.email], fetchImpl); return (d && d.items) || []; }
  catch (e) { return []; }
}
