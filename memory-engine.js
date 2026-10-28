// 🧩 PHASE 9, M7: MEMORY ENGINE (LONG-TERM LAYER)
// Typed, owner-scoped long-term memory for the AI agent.
//
// Blueprint rule (§52 gap: "Formal short/long-term memory split" was MISSING):
// every memory is a *typed* record carrying kind / key / value / source /
// confidence / reason / timestamp / ownerUid. The short-term layer stays where it
// always was (`chatmem:<uid>` in ai-agent.js); this module is the long-term layer.
//
// Owner decision for M7 (deliberate deviation from the plan's "default OFF,
// explicit consent"): long-term memory is on automatically for signed-in students,
// with no setting and no prompt, and it never expires. What does NOT change is the
// safety boundary, guests have no durable identity so they get no memory at all,
// and a memory whose owner is not the caller is a leak, not data.
//
// This module is pure data plus pure guards: no `env`, no I/O, no worker API, and
// it never calls a model. Extraction heuristics live here so the chat path stays
// thin; the chat path decides *when* to extract.

export const MEMORY_VERSION = 'mem-v1';

/** What the AI is allowed to remember. Nothing outside this list is storable. */
export const KIND = Object.freeze({
  STUDIES: 'studies',      // subjects, weak/strong topics, goals
  PREFERENCE: 'preference', // language style, tone, how they like answers
  HABIT: 'habit'           // when/how they study, routine
});

/** Where a memory came from, a statement the student made, or an inference. */
export const SOURCE = Object.freeze({
  USER_STATED: 'user_stated',
  AI_INFERRED: 'ai_inferred'
});

/** A record below this confidence is not a memory yet; it is a guess. */
export const CONFIDENCE_MIN = 0.7;

/** Storage safety valve (not a retention policy): the oldest record is pruned
 *  only when the stored array would exceed this, so a KV value cannot grow
 *  without bound. Records otherwise never expire. */
export const MAX_RECORDS = 500;

/** How many records are rendered into a prompt. Nothing is deleted by this -
 *  it only bounds the context the model sees. Newest and most confident first. */
export const RENDER_LIMIT = 24;

const MAX_VALUE_LEN = 160;
const MAX_REASON_LEN = 160;

/** Patterns that must never appear in a stored memory value or reason. */
const PII_PATTERNS = Object.freeze([
  /[\w.+-]+@[\w-]+\.[\w.]+/,            // email
  /(?:\+?880|0)1[3-9]\d{8}/,            // BD mobile
  /\b\d{10,}\b/,                         // long digit run (ids, cards)
  /\b\d{4}-\d{2}-\d{2}\b/,               // ISO date
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,       // dd/mm/yyyy
  /\b(?:password|passwd|otp|pin|cvv)\b/i,
  /\b(?:verification|verify|varification)\s*code\b/i
]);

export function getKinds() { return Object.values(KIND); }

/**
 * Collapse whitespace and drop control characters so a value renders cleanly and
 * cannot smuggle prompt structure. Returns '' for anything empty.
 */
export function sanitizeMemoryText(text, maxLen = MAX_VALUE_LEN) {
  const value = String(text == null ? '' : text)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value.slice(0, maxLen);
}

/** True when the text carries no PII/secret pattern. Empty counts as clean. */
export function isPiiFree(text) {
  const value = String(text == null ? '' : text);
  if (!value) return true;
  return !PII_PATTERNS.some(re => re.test(value));
}

/** The owner of a memory is the server-validated uid alone; guests have none. */
export function resolveMemoryOwner(uid) {
  const value = String(uid || '');
  return value.startsWith('account-') ? value : null;
}

/**
 * Build a validated memory record, or null when any rule fails:
 *  - owner must resolve (account only);
 *  - kind must be one of the three allowed kinds;
 *  - source must be a known source;
 *  - confidence must be a finite number at or above CONFIDENCE_MIN;
 *  - key, value and reason must be non-empty and free of PII patterns.
 * `ownerUid` is taken from the argument, never from the record body.
 */
export function makeMemory(input = {}, ownerUid) {
  const owner = resolveMemoryOwner(ownerUid);
  if (!owner) return null;

  const kind = String(input.kind || '');
  if (!getKinds().includes(kind)) return null;

  const source = String(input.source || '');
  if (!Object.values(SOURCE).includes(source)) return null;

  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < CONFIDENCE_MIN || confidence > 1) return null;

  const key = sanitizeMemoryText(input.key, 60);
  const value = sanitizeMemoryText(input.value);
  const reason = sanitizeMemoryText(input.reason, MAX_REASON_LEN);
  if (!key || !value || !reason) return null;
  if (!isPiiFree(value) || !isPiiFree(reason) || !isPiiFree(key)) return null;

  const rawTs = Number(input.ts);
  const ts = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : Date.now();

  return Object.freeze({ kind, key, value, source, confidence, reason, ts, ownerUid: owner });
}

/**
 * Merge a new record into a list. Identity is kind+key, so a later statement
 * replaces an earlier one for the same fact rather than piling up duplicates.
 * Order is newest-first; the storage valve drops the oldest beyond MAX_RECORDS.
 * A record whose ownerUid is not the caller is discarded, never merged.
 */
export function upsertMemory(list, record, ownerUid) {
  const owner = resolveMemoryOwner(ownerUid);
  const items = Array.isArray(list) ? list.filter(r => r && r.ownerUid === owner) : [];
  if (!record || record.ownerUid !== owner) return items.map(r => Object.freeze({ ...r })).slice(0, MAX_RECORDS);

  const rest = items.filter(r => !(r.kind === record.kind && r.key === record.key));
  const next = [record, ...rest].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return next.slice(0, MAX_RECORDS).map(r => Object.freeze({ ...r }));
}

/** Parse a stored KV value into a clean, owner-filtered list. Never throws. */
export function parseMemory(raw, ownerUid) {
  const owner = resolveMemoryOwner(ownerUid);
  if (!owner) return [];
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; } catch (_) { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(r => r && r.ownerUid === owner && getKinds().includes(r.kind) && isPiiFree(r.value))
    .map(r => Object.freeze({ ...r }))
    .slice(0, MAX_RECORDS);
}

/** Second gate: a record read back must belong to the caller. */
export function guardMemoryRecord(record, callerUid) {
  const owner = resolveMemoryOwner(callerUid);
  if (!owner) return { ok: false, reason: 'no-owner-identity' };
  if (!record || typeof record !== 'object') return { ok: false, reason: 'empty-record' };
  if (String(record.ownerUid || '') !== owner) return { ok: false, reason: 'owner-mismatch' };
  if (!getKinds().includes(record.kind)) return { ok: false, reason: 'unknown-kind' };
  if (!isPiiFree(record.value) || !isPiiFree(record.reason)) return { ok: false, reason: 'pii-detected' };
  return { ok: true, reason: 'ok' };
}

/** Structural self-check, mirroring the other registries. */
export function validateMemoryEngine() {
  const problems = [];
  if (!(CONFIDENCE_MIN > 0 && CONFIDENCE_MIN <= 1)) problems.push('CONFIDENCE_MIN out of range');
  if (!(MAX_RECORDS >= 1)) problems.push('MAX_RECORDS invalid');
  if (!(RENDER_LIMIT >= 1)) problems.push('RENDER_LIMIT invalid');
  if (getKinds().length !== 3) problems.push('kind set drifted');
  if (!isPiiFree('পদার্থবিজ্ঞান দুর্বল')) problems.push('clean text flagged');
  if (isPiiFree('a@b.com')) problems.push('email not flagged');
  if (isPiiFree('01XXXXXXXXX'.replace(/X/g, '7'))) problems.push('mobile not flagged');
  if (!(makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.5, reason: 'r' }, 'account-a') === null)) {
    problems.push('low confidence accepted');
  }
  if (!(makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'guest-x') === null)) {
    problems.push('guest owner accepted');
  }
  return problems;
}

/* ── Extraction heuristics ────────────────────────────────────────────────────
   Both triggers the owner asked for are recognised here: something the student
   said explicitly ("মনে রাখো"), and a study/preference/habit fact stated in
   passing. This is intentionally conservative, a candidate still has to clear
   makeMemory() before it becomes a memory, so a weak signal never stores. */

const RETAIN_TRIGGERS = Object.freeze([
  'মনে রাখো', 'মনে রাখ', 'মনে রেখো', 'remember this', 'remember that', 'note this'
]);

const FRAG = '[\\p{L}\\p{M}\\p{N} ,.।-]';
/* A goal stops at a comma / danda, so the next clause ("…, সমাসে দুর্বল") never leaks in. */
const GOAL_FRAG = '[\\p{L}\\p{M}\\p{N} .-]';

const SIGNALS = Object.freeze([
  { kind: KIND.STUDIES, key: 'weak-topic', re: /((?:\S+\s+){0,3})(?:দুর্বল|পারি না|কঠিন লাগে|weak in|struggl\w* with)/iu, confidence: 0.8 },
  { kind: KIND.STUDIES, key: 'strong-topic', re: /((?:\S+\s+){0,3})(?:ভালো|strong in|good at)/iu, confidence: 0.75 },
  { kind: KIND.STUDIES, key: 'goal', re: new RegExp(`(?:লক্ষ্য|টার্গেট|goal|target)\\s*(?:হলো|হল|হচ্ছে|is)?\\s*[:\\-–]?\\s*(${GOAL_FRAG}{2,60})`, 'iu'), confidence: 0.8 },
  /* Sky step 3: "আমি ঢাকা মেডিকেলে ভর্তি হতে চাই" / "ঢাবিতে চান্স পেতে চাই" is a goal too. */
  { kind: KIND.STUDIES, key: 'goal', re: /((?:\S+\s+){0,4}?\S+?)(?:-?(?:এ|তে|য়))?\s+(?:ভর্তি\s*হতে|চান্স\s*পেতে|পড়তে)\s*চাই/iu, confidence: 0.8 },
  // The trigger itself is the preference, trailing words add nothing.
  { kind: KIND.PREFERENCE, key: 'answer-style', re: /(ছোট করে|বিস্তারিত|detailed|short answers?|সহজ করে|simple করে)/iu, confidence: 0.75 },
  { kind: KIND.HABIT, key: 'study-time', re: /((?:রাতে|সকালে|বিকেলে|দুপুরে|at night|in the morning|evening)\s*(?:পড়ি|পড়াশোনা|study)[\p{L}\p{M}\p{N} ,.।-]{0,40})/iu, confidence: 0.75 }
]);

/* Words that add no information to a captured topic ("আমি", "রাখো"…). */
const FILLER_WORDS = Object.freeze(['আমি', 'আমার', 'আমাকে', 'we', 'i', 'my', 'me', 'মনে', 'রাখো', 'রাখ', 'রেখো']);

function cleanCapture(text) {
  const cleaned = String(text || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/)
    .map(word => word.replace(/[,।]/g, ''))
    .filter(word => word && !FILLER_WORDS.includes(word.toLowerCase()))
    .join(' ');
  return sanitizeMemoryText(cleaned, 80);
}

const TOPIC_KEYS = Object.freeze(['weak-topic', 'strong-topic', 'goal']);
const QUESTION_WORD = /(?:^|\s)(?:কী|কি|কোন|কোনটা|কোনগুলো|কোথায়|কিসে|কীসে|কেন|কীভাবে|কিভাবে|what|which|where|am i)(?=\s|$)/iu;
function isQuestionClause(clause) {
  return QUESTION_WORD.test(String(clause || '')) || /দুর্বলতা/u.test(String(clause || ''));
}

/** Did the student explicitly ask the AI to remember something? */
export function isRetentionRequest(text) {
  const value = String(text || '');
  return RETAIN_TRIGGERS.some(trigger => value.includes(trigger));
}

/**
 * Turn a user message into memory candidates. Returns an array of inputs to feed
 * makeMemory(), nothing here is stored, and nothing here is trusted yet.
 */
export function extractMemoryCandidates(text) {
  const value = sanitizeMemoryText(text, 600);
  if (!value) return [];
  const out = [];
  const explicit = isRetentionRequest(value);

  /* Sky memory fix 2026-10-18: a question ("আমি কোন বিষয়ে দুর্বল?") is not a
     fact. Topic signals are matched only inside statement clauses, so asking
     about a weakness never overwrites the weakness the student stated before. */
  /* Sky step 3: each clause is matched on its own, so a capture never spans two
     clauses ("…পড়া, সমাসে দুর্বল" → weak "সমাসে", not "পড়া সমাসে"), and a
     goal question ("আমার লক্ষ্য কী?") never overwrites the stated goal. */
  const clauses = value.split(/[?？!।\n]|,\s*/).filter(c => c.trim() && !isQuestionClause(c));
  const seenKeys = new Set();

  for (const signal of SIGNALS) {
    if (seenKeys.has(signal.key)) continue;
    let match = null;
    if (TOPIC_KEYS.includes(signal.key)) {
      for (const clause of clauses) { match = clause.match(signal.re); if (match) break; }
    } else {
      match = value.match(signal.re);
    }
    if (!match) continue;
    const captured = cleanCapture(match[1] || match[0]);
    if (!captured) continue;
    seenKeys.add(signal.key);
    out.push({
      kind: signal.kind,
      key: signal.key,
      value: captured,
      source: explicit ? SOURCE.USER_STATED : SOURCE.AI_INFERRED,
      confidence: explicit ? Math.min(1, signal.confidence + 0.1) : signal.confidence,
      reason: explicit ? 'ইউজার নিজে মনে রাখতে বলেছে' : 'কথার মধ্যে থেকে অনুমান করা হয়েছে'
    });
  }
  return out;
}

/* Each remembered fact is labelled by what it IS, so the model can tell a weak
   topic from a goal or the last discussed subject. Without this every study
   fact rendered as a bare "পড়াশোনা: সমাসে" and the tutor could not see that
   the student had called it a weakness. */
const KEY_LABEL = Object.freeze({
  'weak-topic': 'দুর্বল বিষয় (শিক্ষার্থী নিজে বলেছে)',
  'strong-topic': 'ভালো পারে (শিক্ষার্থী নিজে বলেছে)',
  'goal': 'লক্ষ্য',
  'last-topic': 'সর্বশেষ আলোচনার বিষয়',
  'answer-style': 'উত্তরের ধরন',
  'study-time': 'পড়ার অভ্যাস'
});

/** The weak topics the student stated in chat, newest first (values only). */
export function statedWeakTopics(records, limit = 3) {
  const items = Array.isArray(records) ? records : [];
  const seen = new Set();
  const out = [];
  for (const r of items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    if (!r || r.kind !== KIND.STUDIES || r.key !== 'weak-topic') continue;
    const value = sanitizeMemoryText(r.value, 80);
    if (!value || !isPiiFree(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/** Sky step 3: the newest admission goal the student stated in chat, or ''. */
export function statedGoal(records) {
  const items = Array.isArray(records) ? records : [];
  for (const r of items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    if (!r || r.kind !== KIND.STUDIES || r.key !== 'goal') continue;
    const value = sanitizeMemoryText(r.value, 80);
    if (value && isPiiFree(value)) return value;
  }
  return '';
}

const KIND_LABEL = Object.freeze({
  [KIND.STUDIES]: 'পড়াশোনা',
  [KIND.PREFERENCE]: 'পছন্দ',
  [KIND.HABIT]: 'অভ্যাস'
});

/**
 * Render the caller's memories as prompt lines, newest and most confident first.
 * Returns '' when there is nothing to say, so an empty memory adds no prompt text
 * and the pre-M7 path stays byte-identical.
 */
export function renderMemory(records, viewVersion = '') {
  const items = Array.isArray(records) ? records.slice() : [];
  if (!items.length) return '';
  const ranked = items
    .sort((a, b) => (b.confidence - a.confidence) || ((b.ts || 0) - (a.ts || 0)))
    .slice(0, RENDER_LIMIT);
  const lines = ranked.map(r => `- ${KIND_LABEL[r.kind] || r.kind}, ${KEY_LABEL[r.key] || r.key}: ${r.value}`);
  const v = viewVersion ? ', ' + viewVersion : '';
  const weakRule = ranked.some(r => r.kind === KIND.STUDIES && r.key === 'weak-topic')
    ? '\nশিক্ষার্থী নিজের দুর্বলতা বা কী পড়বে জানতে চাইলে প্রথম উত্তরেই "দুর্বল বিষয় (শিক্ষার্থী নিজে বলেছে)" লাইনটি ব্যবহার করো, পরীক্ষার ফল না থাকলেও। '
      + 'কখনো বলবে না "দুর্বলতার কোনো তথ্য নেই"। উদাহরণ: "তুমি এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে সমাসে দুর্বল। আজ সমাস দিয়ে শুরু করি?"'
    : '';
  return `\n\nLONG-TERM MEMORY${v}:\n${lines.join('\n')}\n`
    + 'এই তথ্য শুধু এই শিক্ষার্থীর নিজেরই। স্বাভাবিকভাবে কাজে লাগাও; কখনো বলো না তুমি আলাদা করে কিছু মনে রেখেছ।' + weakRule;
}