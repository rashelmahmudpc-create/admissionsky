// Fresh Start phase 4, list (default) or wipe every user.
// MODE=list  : read-only. Prints exact counts + a MASKED list (public repo logs).
// MODE=wipe  : needs CONFIRM === `WIPE-FB<firebaseUsers>-CF<cloudflareUsers>` for the
//              counts measured in this same run; otherwise exits before deleting.
// Kept: OTP config/provider state/quota, schema meta, content tables, system KV keys,
//       R2 notify/ images and backups.
import { createSign } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const MODE = process.env.MODE === 'wipe' ? 'wipe' : 'list';
const CONFIRM = String(process.env.CONFIRM || '').trim();
const PROJECT = 'admissionsky-997d2';
const SITE = 'https://admissionsky.pages.dev';
const ACC = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF = `https://api.cloudflare.com/client/v4/accounts/${ACC}`;
const D1_ID = '8f7cf101-66a3-437d-bc98-a8984698d7f5';
const KV = { GK_KV: 'b9353515b098427687afcfb8654ed359', OLD_KV: '942828aa82e546d4af11796ef92ab134' };
const KV_USER_PREFIXES = new Set(['tok', 'user', 'sess', 'pkid', 'ustate', 'profile', 'chatmem', 'achat', 'mem', 'aiprefs', 'act', 'actaudit']);
const D1_KEEP = new Set(['questions', 'content_lists', 'content_meta', 'global_notifications', 'ai_cache', 'ai_experiments']);
const D1_USER_COLS = new Set(['user_id', 'uid', 'owner_uid', 'account_id', 'userid']);
const R2_BUCKET = 'admission-hub';
const R2_USER_KEY = /^(?!notify\/)[a-z][a-z0-9-]{0,31}\/[A-Za-z0-9_-]{1,64}\/\d{4}-\d{2}-\d{2}\/[a-z0-9]{10,24}\.[a-z0-9]{2,4}$/;

const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
const mask = e => { const [u, d] = String(e || '').split('@'); return d ? `${u.slice(0, 1)}***@${d}` : '(no email)'; };
const day = ms => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : '-');

// ---------- Firebase ----------
async function googleToken() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  if (sa.project_id && sa.project_id !== PROJECT) throw new Error(`service account is for ${sa.project_id}, not ${PROJECT}`);
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`google token failed: ${r.status}`);
  return j.access_token;
}
async function firebaseUsers(token) {
  const users = []; let next = '';
  do {
    const u = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet`);
    u.searchParams.set('maxResults', '1000'); if (next) u.searchParams.set('nextPageToken', next);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json(); if (!r.ok) throw new Error(`firebase list ${r.status}: ${j?.error?.message}`);
    users.push(...(j.users || [])); next = j.nextPageToken || '';
  } while (next);
  return users;
}
async function firebaseDelete(token, ids) {
  let deleted = 0; const errors = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchDelete`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ localIds: ids.slice(i, i + 1000), force: true }) });
    const j = await r.json(); if (!r.ok) throw new Error(`firebase delete ${r.status}: ${j?.error?.message}`);
    errors.push(...(j.errors || [])); deleted += Math.min(1000, ids.length - i) - (j.errors || []).length;
  }
  return { deleted, errors: errors.length };
}

// ---------- Cloudflare ----------
const cfh = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
async function cf(path, init = {}) {
  const r = await fetch(`${CF}${path}`, { ...init, headers: { ...cfh, ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`cloudflare ${path.split('?')[0]} ${r.status}: ${JSON.stringify(j.errors || '').slice(0, 200)}`);
  return j;
}
const d1 = async sql => (await cf(`/d1/database/${D1_ID}/query`, { method: 'POST', body: JSON.stringify({ sql }) })).result[0].results;
async function d1UserTables() {
  const tables = (await d1("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name")).map(r => r.name);
  const res = {};
  for (const t of tables) {
    if (D1_KEEP.has(t) || !/^[A-Za-z0-9_]+$/.test(t)) continue;
    const cols = (await d1(`PRAGMA table_info("${t}")`)).map(c => String(c.name).toLowerCase());
    if (!cols.some(c => D1_USER_COLS.has(c))) continue;
    res[t] = Number((await d1(`SELECT COUNT(*) AS n FROM "${t}"`))[0].n);
  }
  return res;
}
async function kvUserKeys(ns) {
  const keys = []; let cursor = '';
  do {
    const j = await cf(`/storage/kv/namespaces/${ns}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const k of j.result) if (KV_USER_PREFIXES.has(String(k.name).split(/[:/]/)[0])) keys.push(k.name);
    cursor = j.result_info?.cursor || '';
  } while (cursor);
  return keys;
}
async function r2UserKeys() {
  const keys = []; let cursor = '';
  do {
    const j = await cf(`/r2/buckets/${R2_BUCKET}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const o of j.result || []) if (R2_USER_KEY.test(o.key)) keys.push(o.key);
    cursor = j.result_info?.is_truncated ? j.result_info.cursor : '';
  } while (cursor);
  return keys;
}
async function doWipe(input) {
  const r = await fetch(`${SITE}/api/auth/v1/admin/students/wipe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE, 'X-AH-Admin-Token': process.env.ADMIN_TOKEN }, body: JSON.stringify(input) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`worker wipe ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return j;
}

async function survey(token) {
  const s = {};
  s.fb = await firebaseUsers(token);
  s.doCounts = await doWipe({ dryRun: true });
  s.d1 = await d1UserTables();
  s.kv = {}; for (const [n, id] of Object.entries(KV)) s.kv[n] = await kvUserKeys(id);
  try { s.r2 = await r2UserKeys(); } catch (e) { s.r2 = null; s.r2err = e.message; }
  return s;
}
function report(s, title) {
  log(`## ${title}`);
  log(`PHASE4 Firebase (${PROJECT}) users = ${s.fb.length}`);
  log(`PHASE4 Cloudflare auth users = ${s.doCounts.users} (rows in all wiped tables = ${s.doCounts.rows})`);
  for (const [t, n] of Object.entries(s.doCounts.tables || {})) if (n) log(`PHASE4   DO ${t} = ${n}`);
  log(`PHASE4   DO kept: ${(s.doCounts.kept || []).join(', ')}`);
  for (const [t, n] of Object.entries(s.d1)) log(`PHASE4   D1 ${t} = ${n}`);
  for (const [n, k] of Object.entries(s.kv)) log(`PHASE4   KV ${n} user keys = ${k.length}`);
  log(s.r2 ? `PHASE4   R2 user files = ${s.r2.length}` : `PHASE4   R2 not readable (${s.r2err})`);
}

const token = await googleToken();
const before = await survey(token);
report(before, MODE === 'wipe' ? 'Before wipe' : 'Dry run (nothing deleted)');
log('', '### Firebase users (masked)');
before.fb.sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).forEach((u, i) => log(`${String(i + 1).padStart(3)}. ${mask(u.email)} | ${String(u.localId).slice(0, 6)}… | ${(u.providerUserInfo || []).map(p => p.providerId).join('+') || 'password?'} | created ${day(u.createdAt)} | last ${day(u.lastLoginAt)}`));
const phrase = `WIPE-FB${before.fb.length}-CF${before.doCounts.users}`;
log('', `CONFIRM PHRASE for this exact state: ${phrase}`);

if (MODE === 'wipe') {
  if (CONFIRM !== phrase) { log(`ABORT: confirm "${CONFIRM}" != "${phrase}". Nothing deleted.`); process.exitCode = 1; }
  else {
    log('', '## Deleting');
    log('Firebase:', JSON.stringify(await firebaseDelete(token, before.fb.map(u => u.localId))));
    const w = await doWipe({ dryRun: false, confirm: before.doCounts.confirmPhrase });
    log('Cloudflare auth:', JSON.stringify({ complete: w.outcome?.complete, remaining: w.outcome?.remaining, users_after: w.after?.users }));
    for (let pass = 0; pass < 4; pass += 1) for (const t of Object.keys(before.d1)) { try { await d1(`DELETE FROM "${t}"`); } catch (e) { if (pass === 3) log(`D1 ${t} failed: ${e.message}`); } }
    for (const [n, id] of Object.entries(KV)) { const k = before.kv[n]; for (let i = 0; i < k.length; i += 10000) await cf(`/storage/kv/namespaces/${id}/bulk`, { method: 'DELETE', body: JSON.stringify(k.slice(i, i + 10000)) }); log(`KV ${n} deleted ${k.length}`); }
    if (before.r2) { let n = 0; for (const key of before.r2) { try { await cf(`/r2/buckets/${R2_BUCKET}/objects/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }); n += 1; } catch (e) { log(`R2 ${key.slice(0, 20)} failed`); } } log(`R2 deleted ${n}`); }
    const after = await survey(token);
    report(after, 'After wipe');
    const left = after.fb.length + after.doCounts.users + Object.values(after.d1).reduce((a, b) => a + b, 0) + Object.values(after.kv).reduce((a, k) => a + k.length, 0) + (after.r2?.length || 0);
    log(left === 0 ? 'RESULT: everything is empty ✅' : `RESULT: ${left} items still left ⚠️`);
    if (left) process.exitCode = 1;
  }
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
