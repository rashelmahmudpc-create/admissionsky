// 🧩 PHASE 9 — M6: TOOL REGISTRY (server-side module test)
// Locks the tool registry and the cross-user isolation guard introduced in
// migration step M6. Finding S6 said this risk must be designed in at M6 rather
// than retrofitted, so the tests below attack it directly: the owner of a tool
// call must come from the server-side uid alone, and anything the model or the
// request body supplies must be unable to redirect a tool at another user.
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const T = await import('./tool-registry.js');
const A = await import('./ai-agent.js');
const {
  PERMISSION, RISK, REQUIRED_TOOL_FIELDS, TOOL_REGISTRY_VERSION,
  getTool, listTools, validateToolRegistry, resolveToolOwner, authorizeToolCall, guardToolResult
} = T;

/* ── ১. Registry shape ── */
t('M6-১. registry self-validation passes and the version is stamped',
  Array.isArray(validateToolRegistry()) && validateToolRegistry().length === 0 && TOOL_REGISTRY_VERSION === 'tr-v1');
t('M6-২. every declared tool carries the full required metadata', (() => {
  const rows = listTools();
  return rows.length >= 1
    && rows.every(r => REQUIRED_TOOL_FIELDS.every(f => getTool(r.name)[f] !== undefined));
})());
t('M6-৩. an unknown tool resolves to null, never a stub',
  getTool('nope') === null && getTool('') === null && getTool() === null);

/* ── ২. Permission separation: READ-only may be enabled ── */
t('M6-৪. only READ tools are enabled; no WRITE/EXECUTE capability is on', (() => {
  const rows = listTools();
  return rows.every(r => r.enabled === false || r.permission === PERMISSION.READ)
    && rows.some(r => r.permission === PERMISSION.READ && r.enabled === true);
})());
t('M6-৫. the registry encodes the READ/WRITE/EXECUTE classes explicitly',
  PERMISSION.READ === 'read' && PERMISSION.WRITE === 'write' && PERMISSION.EXECUTE === 'execute'
  && RISK.LOW === 'low' && REQUIRED_TOOL_FIELDS.includes('enabled') && REQUIRED_TOOL_FIELDS.includes('riskLevel'));

/* ── ৩. Owner identity comes from the uid alone ── */
t('M6-৬. only a signed-in account resolves to an owner; a guest never does',
  resolveToolOwner('account-abc') === 'account-abc' && resolveToolOwner('guest-abc') === null
  && resolveToolOwner('') === null && resolveToolOwner(null) === null);

/* ── ৪. Cross-user isolation at the tool boundary (finding S6) ── */
t('M6-৭. a guest cannot invoke any tool', (() => {
  const d = authorizeToolCall('student.progress.read', { uid: 'guest-xyz' });
  return d.allowed === false && d.reason === 'no-owner-identity' && d.owner === null;
})());
t('M6-৮. an unknown or disabled tool is denied', (() => {
  return authorizeToolCall('does.not.exist', { uid: 'account-a' }).reason === 'unknown-tool'
    && authorizeToolCall('student.progress.read', {}).reason === 'no-owner-identity';
})());
t('M6-৯. arguments cannot smuggle another owner — every owner-ish key is rejected', (() => {
  const keys = ['uid', 'ownerUid', 'owner', 'userId', 'accountId', 'user', 'account', 'deviceId'];
  return keys.every(k => {
    const d = authorizeToolCall('student.progress.read', { uid: 'account-a', args: { [k]: 'account-b' } });
    return d.allowed === false && d.reason === 'owner-from-args-rejected';
  });
})());
t('M6-১০. the owner returned by authorize is always the caller, never a supplied value', (() => {
  const ok = authorizeToolCall('student.progress.read', { uid: 'account-A', args: { topic: 'physics' } });
  return ok.allowed === true && ok.owner === 'account-A';
})());

/* ── ৫. Result-side guard: a mismatched owner is a leak, not data ── */
t('M6-১১. a result owned by someone else is blocked, a matching one passes', (() => {
  return guardToolResult({ ownerUid: 'account-b' }, 'account-a').ok === false
    && guardToolResult({ ownerUid: 'account-b' }, 'account-a').reason === 'owner-mismatch'
    && guardToolResult({ ownerUid: 'account-a' }, 'account-a').ok === true
    && guardToolResult({ ownerUid: 'account-a' }, 'guest-x').ok === false;
})());
t('M6-১২. a missing or empty result is refused rather than trusted',
  guardToolResult(null, 'account-a').ok === false && guardToolResult({}, 'account-a').ok === false);

/* ── ৬. M6 grants no runtime capability and changes no prompt ── */
/* Agent phase 1 (owner 2026-10-17): tools now run, but only through the READ-only,
   owner-scoped runner in sky-tools.mjs — never by a name the model supplies. */
t('M6-১৩. the chat path runs tools only through sky-tools.mjs (READ-only runner)', (() => {
  const agentSrc = readFileSync('ai-agent.js', 'utf8');
  const toolsSrc = readFileSync('sky-tools.mjs', 'utf8');
  return typeof T.authorizeToolCall === 'function'
    && agentSrc.includes("from './sky-tools.mjs'")
    && !/executeTool|invokeTool/i.test(agentSrc)
    && /owner-from-args-rejected/.test(toolsSrc)
    && !/dbPut|\.put\(|\.delete\(/.test(toolsSrc)
    && agentSrc.includes('listTools');
})());
t('M6-১৪. the prompt text and its hash are unchanged by M6', (() => {
  return createHash('sha256').update(A.buildSystemPrompt({})).digest('hex')
    === 'e0f49e242fe3b4f342afdccf4cdcd40c36054d2310181dcf86b337982edb500f';
})());
t('M6-১৫. agentStatus advertises declared tools without exposing any executable path', (() => {
  const src = readFileSync('ai-agent.js', 'utf8');
  return src.includes('tools: { version: TOOL_REGISTRY_VERSION, declared: listTools() }')
    && A.__test.listTools().every(r => typeof r.name === 'string');
})());

console.log(`\n🛠️  PHASE9-M6-TOOL-REGISTRY: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);