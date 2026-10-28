/**
 * 🎙️ P23, LIVE VOICE AGENT · CORE
 *
 * Pure, dependency-free engine behind the streaming voice session. Everything
 * here is testable without a network or a Worker; the Durable Object in
 * voice-agent.mjs is a thin transport shell over this.
 *
 * Design commitments (owner, 2026-10-11):
 *  • A provider POOL, never a single key. When one key's limit ends the next
 *    takes over automatically, the owner swaps a key in the dashboard, not code.
 *  • Memory is a SEPARATE layer from the voice/model. Swapping a key or model
 *    must never lose context, so nothing here stores conversation state inside
 *    a provider config.
 *  • Speed is the feature: the session is a small state machine that can hand
 *    the first audio out before the full reply exists.
 */

export const VOICE_AGENT_VERSION = 'voice-v1';

/* ── Provider kinds ─────────────────────────────────────────────────────── */
export const KIND = Object.freeze({
  STT: 'stt', // speech  -> text
  LLM: 'llm', // text    -> text
  TTS: 'tts', // text    -> speech
});

/* Provider ids we know how to call. An entry the pool cannot name is rejected
 * at parse time rather than failing mid-conversation. */
export const PROVIDERS = Object.freeze({
  'groq-whisper': { kind: KIND.STT, label: 'Groq Whisper' },
  'deepgram':     { kind: KIND.STT, label: 'Deepgram' },
  'gemini-stt':   { kind: KIND.STT, label: 'Gemini' },

  'groq-llama':   { kind: KIND.LLM, label: 'Groq Llama' },
  'gemini-llm':   { kind: KIND.LLM, label: 'Gemini Flash' },
  'openrouter':   { kind: KIND.LLM, label: 'OpenRouter' },
  'openai-compat':{ kind: KIND.LLM, label: 'OpenAI/Gateway' },

  'cartesia':     { kind: KIND.TTS, label: 'Cartesia' },
  'cartesia-2':   { kind: KIND.TTS, label: 'Cartesia (secondary)' },
  'elevenlabs':   { kind: KIND.TTS, label: 'ElevenLabs' },
  'gemini-tts':   { kind: KIND.TTS, label: 'Gemini Voice' },
});

/* An HTTP status that means "this key is done for now, try the next".
 * 429 rate limit, 402 payment/quota, 401/403 dead or forbidden key. A 5xx is
 * treated the same way: a provider that is down is a provider we move past. */
export function isFailoverStatus(status) {
  const n = Number(status);
  if (!Number.isFinite(n)) return false;
  return n === 401 || n === 402 || n === 403 || n === 429 || (n >= 500 && n < 600);
}

/* A provider entry that carries a credential. Anything secret-shaped is
 * scrubbed before it can reach a log line, a log is not a transcript. */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gsk_[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /ck_[A-Za-z0-9_-]{16,}/g,
  /xoxb-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\beyJ[A-Za-z0-9._-]{20,}/g,
];

export function sanitizeSecret(text) {
  let out = String(text == null ? '' : text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/* ── Pool parsing ───────────────────────────────────────────────────────── */

/**
 * Parse one pool from a config value. Accepts the JSON string an operator puts
 * in a Worker variable/secret, or an already-parsed array.
 *
 *   [{"id":"cartesia","key":"..."},{"id":"cartesia-2","key":"..."}]
 *
 * An entry is dropped, not thrown on, when it names an unknown provider, is
 * missing its credential, or declares the wrong kind. A malformed pool must
 * degrade to "fewer providers", never to a broken session.
 */
export function parsePool(raw, kind) {
  let list = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try { list = JSON.parse(trimmed); } catch (_) { return []; }
  }
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const spec = PROVIDERS[id];
    if (!spec || spec.kind !== kind) continue;
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!key) continue;
    if (seen.has(id)) continue; // one slot per provider id, no accidental duplicates
    seen.add(id);
    out.push(Object.freeze({
      id,
      label: spec.label,
      key,
      model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : null,
      voiceId: typeof entry.voiceId === 'string' && entry.voiceId.trim() ? entry.voiceId.trim() : null,
      url: typeof entry.url === 'string' && entry.url.trim() ? entry.url.trim() : null,
      gatewayToken: typeof entry.gatewayToken === 'string' && entry.gatewayToken.trim() ? entry.gatewayToken.trim() : null,
    }));
  }
  return out;
}

/**
 * Build the three ordered pools from a flat config bag. Missing pools come back
 * empty rather than undefined so callers can test `pool.stt.length` safely.
 */
export function parseProviderPools(config = {}) {
  return Object.freeze({
    stt: parsePool(config.stt, KIND.STT),
    llm: parsePool(config.llm, KIND.LLM),
    tts: parsePool(config.tts, KIND.TTS),
  });
}

/* ── Failover runner ────────────────────────────────────────────────────── */

/**
 * Try each provider in order until one succeeds.
 *
 * `call(provider, index)` returns a promise resolving to a result. A rejection
 * whose `.status` passes isFailoverStatus moves to the next provider; anything
 * else (a bad request, an empty body) is a real error and stops the walk, because
 * retrying a malformed request across every key only burns the remaining quota.
 *
 * `onFailover` is an observability hook, it receives a sanitized note, never a
 * credential.
 */
export async function runWithFailover(pool, call, onFailover) {
  if (!Array.isArray(pool) || pool.length === 0) {
    const err = new Error('no_provider_configured');
    err.status = 503;
    throw err;
  }
  let lastError = null;
  for (let i = 0; i < pool.length; i++) {
    const provider = pool[i];
    try {
      return { result: await call(provider, i), provider: provider.id, index: i };
    } catch (e) {
      lastError = e;
      const status = e && e.status;
      // A gateway entry opts into failing over on ANY error, because the direct
      // provider entry behind it is a real fallback, a gateway 404 must not
      // take the turn down the way a plain client error would.
      const failover = provider.failoverOnAnyError ? true : isFailoverStatus(status);
      if (typeof onFailover === 'function') {
        try {
          onFailover({
            provider: provider.id,
            index: i,
            status: Number.isFinite(Number(status)) ? Number(status) : null,
            reason: sanitizeSecret((e && e.message) || 'error').slice(0, 160),
            failover,
            remaining: pool.length - i - 1,
          });
        } catch (_) { /* an observability hook must never break the call */ }
      }
      if (!failover) throw e;
    }
  }
  const err = new Error(`all_providers_exhausted: ${sanitizeSecret(lastError && lastError.message)}`);
  err.status = 502;
  err.cause = lastError;
  throw err;
}

/* ── Session state machine ──────────────────────────────────────────────── */

export const STATE = Object.freeze({
  IDLE: 'idle',           // connected, waiting for the owner to speak
  LISTENING: 'listening', // capturing audio
  THINKING: 'thinking',   // STT done, LLM working
  SPEAKING: 'speaking',   // audio streaming back
  CLOSED: 'closed',
});

/* Legal transitions. A turn can be interrupted while SPEAKING (barge-in), which
 * is why SPEAKING -> LISTENING is allowed. */
const TRANSITIONS = Object.freeze({
  [STATE.IDLE]:      [STATE.LISTENING, STATE.CLOSED],
  [STATE.LISTENING]: [STATE.THINKING, STATE.IDLE, STATE.CLOSED],
  [STATE.THINKING]:  [STATE.SPEAKING, STATE.IDLE, STATE.CLOSED],
  [STATE.SPEAKING]:  [STATE.LISTENING, STATE.IDLE, STATE.CLOSED],
  [STATE.CLOSED]:    [],
});

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function createSession(now = () => Date.now()) {
  let state = STATE.IDLE;
  let history = [];          // { role, text, ts }
  const turns = [];          // { sttMs, llmMs, ttsMs, totalMs }
  let summary = '';
  let pendingTurn = null;

  return {
    get state() { return state; },
    get history() { return history.slice(); },
    get turns() { return turns.slice(); },
    get summary() { return summary; },

    /**
     * Rehydrate from durable storage after a reconnect or redeploy. Kept here
     * rather than letting a caller push onto the `history` getter, which returns
     * a copy and would silently discard the restore.
     */
    restore(savedHistory, savedSummary, limit = 200) {
      history = Array.isArray(savedHistory) ? savedHistory.slice(-limit) : [];
      summary = typeof savedSummary === 'string' ? savedSummary.slice(0, MAX_SUMMARY_LEN) : '';
      state = STATE.IDLE;
      return history.length;
    },

    transition(to) {
      if (!canTransition(state, to)) {
        const err = new Error(`illegal_transition:${state}->${to}`);
        err.status = 409;
        throw err;
      }
      state = to;
      return state;
    },

    /** Begin a turn: the owner started speaking. */
    beginTurn() {
      this.transition(STATE.LISTENING);
      pendingTurn = { startedAt: now(), sttMs: null, llmMs: null, ttsMs: null };
      return pendingTurn;
    },

    /** STT finished; `text` is what the owner said. */
    endListening(text, sttMs) {
      this.transition(STATE.THINKING);
      if (pendingTurn) pendingTurn.sttMs = sttMs;
      const said = String(text || '').trim();
      if (said) history.push({ role: 'user', text: said, ts: now() });
      return said;
    },

    /** The agent produced a reply. */
    endThinking(replyText, llmMs) {
      this.transition(STATE.SPEAKING);
      if (pendingTurn) pendingTurn.llmMs = llmMs;
      const said = String(replyText || '').trim();
      if (said) history.push({ role: 'agent', text: said, ts: now() });
      return said;
    },

    /** Audio finished streaming; the turn is over. */
    endSpeaking(ttsMs) {
      if (pendingTurn) {
        pendingTurn.ttsMs = ttsMs;
        pendingTurn.totalMs = now() - pendingTurn.startedAt;
        turns.push(Object.freeze({ ...pendingTurn }));
        pendingTurn = null;
      }
      this.transition(STATE.IDLE);
      return turns[turns.length - 1] || null;
    },

    /** Barge-in: the owner talks over the agent. */
    interrupt() {
      if (pendingTurn) {
        pendingTurn.totalMs = now() - pendingTurn.startedAt;
        turns.push(Object.freeze({ ...pendingTurn }));
        pendingTurn = null;
      }
      if (state === STATE.SPEAKING || state === STATE.THINKING) {
        this.transition(STATE.LISTENING);
      }
      return state;
    },

    setSummary(text) { summary = String(text || '').slice(0, MAX_SUMMARY_LEN); return summary; },

    close() { if (state !== STATE.CLOSED) state = STATE.CLOSED; },

    /* Latency rollup, the number the owner actually feels. */
    stats() {
      if (!turns.length) return { turns: 0, avgTotalMs: null, p95TotalMs: null };
      const totals = turns.map(t => t.totalMs).filter(Number.isFinite).sort((a, b) => a - b);
      const sum = totals.reduce((a, b) => a + b, 0);
      return {
        turns: turns.length,
        avgTotalMs: Math.round(sum / totals.length),
        p95TotalMs: totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))],
      };
    },
  };
}

/* ── Prompt + memory assembly ───────────────────────────────────────────── */

export const MAX_SUMMARY_LEN = 1200;
export const HISTORY_WINDOW = 12; // turns of raw history sent to the model

/**
 * The system prompt. The owner's requirement is that the agent addresses him the
 * way I do and carries the same brain, so the persona lives here and the
 * long-term memory arrives as rendered text, not as a provider setting.
 */
export function buildSystemPrompt({ brain = '', memory = '', summary = '', ownerName = 'স্যার' } = {}) {
  const parts = [
    `তুমি একটি লাইভ কণ্ঠসহায়ক। ব্যবহারকারীকে সবসময় "${ownerName}" বলে সম্বোধন করবে।`,
    'সংক্ষিপ্ত, স্পষ্ট, মানুষের মতো বাংলায় কথা বলবে, যেন ফোনে বলা হচ্ছে।',
    'একটি উত্তর দুই-তিন বাক্যের বেশি নয়, কারণ উত্তর শোনা হচ্ছে, পড়া হচ্ছে না।',
    'শুধু ব্যবহারকারীর ঠিক যে প্রশ্নটি করেছে তার উত্তর দেবে। বিষয় বদলাবে না, নিজের ইতিহাস নিয়ে বলবে না, নিজের ক্ষমতা বা প্রোগ্রাম নিয়ে কথা তুলবে না।',
    'প্রশ্ন অস্পষ্ট হলে এক লাইনে জিজ্ঞেস করবে, অনুমান করে লম্বা উত্তর দেবে না।',
    'কোনো সংখ্যা, তারিখ বা তথ্য নিশ্চিত না হলে বানিয়ে বলবে না; বলবে যে জানা নেই।',
    'প্রতিটি উত্তরে "স্যার" বলবে না, যে প্রশ্ন করছে সে স্যার, তাই প্রতিবার সম্বোধনের দরকার নেই। ওয়ালাইকুম আসসালাম বা কোনো সম্ভাষণ প্রতি উত্তরে বলবে না; কেবল প্রথমবার কেউ সালাম দিলে একবার উত্তর দেবে।',
    'উত্তর শুরুতেই মূল কথা বলবে, ভূমিকা, তালিকা বা বিন্যাস নয়।'
  ];
  if (brain) parts.push('', '- ব্রেইন -', String(brain).slice(0, 4000));
  if (memory) parts.push('', '- দীর্ঘমেয়াদি স্মৃতি -', String(memory).slice(0, 2000));
  if (summary) parts.push('', '- আগের কথার সারমর্ম -', String(summary).slice(0, MAX_SUMMARY_LEN));
  return parts.join('\n');
}

/**
 * Drop a greeting the model stapled to the front of a reply when it has already
 * been said this session. The model answers from a window that starts with the
 * owner's "assalamu alaikum", so it greeted every single turn otherwise, the
 * owner's complaint. Only a leading greeting tied to a following clause is
 * removed, so a reply that is itself a greeting is left alone.
 */
const LEADING_GREETING = /^(?:ওয়ালাইকুম[\s-]*আসসালাম|আসসালামু[\s-]*আলাইকুম|ওয়ালাইকুম\s*সালাম|আসসালাম)[,!।\-–—\s]*(?:স্যার[,!।\s]*)?/;
export function stripLeadingGreeting(text) {
  const s = String(text == null ? '' : text).trim();
  const rest = s.replace(LEADING_GREETING, '').trim();
  return rest.length >= 12 ? rest : s;
}

/**
 * Split a reply into sentence-sized chunks so the first one can be spoken
 * before the rest arrives, the fix for "too slow". A short reply stays whole,
 * and no chunk exceeds `max`, so even a run-on reply streams in pieces.
 */
export function splitSentences(text, max = 200) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out = [];
  let buf = '';
  // Bengali দাঁড়ি (।) and ?! always end a sentence. A full stop only ends one
  // when it is NOT between digits, otherwise "৩.৫ ডিগ্রি" was split into "৩."
  // and "৫", and the voice read a decimal as two broken numbers.
  const parts = clean.split(/(?<=[।!?\n])|(?<!\d)\.(?=\s|$)/);
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    if (buf && (buf + ' ' + piece).length > max) { out.push(buf); buf = piece; }
    else buf = buf ? buf + ' ' + piece : piece;
  }
  if (buf) out.push(buf);
  return out;
}


/**
 * Build the model messages: the rolling summary as a prior turn, then the raw
 * recent window. Summary-first keeps long conversations cheap without dropping
 * the thread, the memory layer owns the durable copy.
 */
export function buildMessages(history = [], summary = '') {
  const msgs = [];
  if (summary) msgs.push({ role: 'assistant', content: `[আগের সারমর্ম] ${summary}` });
  const recent = history.slice(-HISTORY_WINDOW);
  for (const turn of recent) {
    msgs.push({ role: turn.role === 'agent' ? 'assistant' : 'user', content: String(turn.text || '') });
  }
  return msgs;
}

/**
 * Fold the oldest turns into the summary once history outgrows the window.
 * Deliberately dumb and local: no extra model call, so a long session cannot
 * quietly start costing a second request per turn.
 */
export function foldSummary(history, summary = '', keep = HISTORY_WINDOW) {
  if (history.length <= keep) return { summary: String(summary || ''), folded: 0 };
  const overflow = history.slice(0, history.length - keep);
  const lines = overflow.map(t => `${t.role === 'agent' ? 'সহায়ক' : 'ব্যবহারকারী'}: ${String(t.text || '').trim()}`);
  const combined = [summary, ...lines].filter(Boolean).join('\n');
  return { summary: combined.slice(-MAX_SUMMARY_LEN), folded: overflow.length };
}

/* ── Session tickets ────────────────────────────────────────────────────── */

/**
 * The socket spends the owner's paid provider quota, so it must not be open to
 * anyone who finds the URL. A browser cannot set a header on a WebSocket
 * handshake, so the page first proves itself over HTTP (where headers work),
 * receives a single-use ticket, and presents that on the upgrade.
 *
 * Tickets are short-lived and consumed on use: a leaked URL from a log or a
 * screenshot is worthless a minute later.
 */
export const TICKET_TTL_MS = 60000;
export const MAX_LIVE_TICKETS = 5;

export function makeTicket(nowMs, rand) {
  const id = rand ? rand()
    : (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return { id: String(id), exp: nowMs + TICKET_TTL_MS };
}

/** Drop expired tickets. Called before every issue and every check. */
export function pruneTickets(tickets, nowMs) {
  const list = Array.isArray(tickets) ? tickets : [];
  return list.filter(t => t && typeof t.id === 'string' && Number.isFinite(t.exp) && t.exp > nowMs);
}

/**
 * Consume a ticket. Returns the remaining tickets and whether it was valid.
 * A used or expired ticket never survives: one presentation, one socket.
 */
export function consumeTicket(tickets, presented, nowMs) {
  const live = pruneTickets(tickets, nowMs);
  const id = String(presented || '');
  if (!id) return { ok: false, reason: 'missing', tickets: live };
  const idx = live.findIndex(t => t.id === id);
  if (idx === -1) return { ok: false, reason: 'invalid', tickets: live };
  live.splice(idx, 1);
  return { ok: true, tickets: live };
}

/** Constant-time-ish compare for the optional access token. */
export function safeEqual(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ── Self-validation ────────────────────────────────────────────────────── */

/**
 * Cloudflare AI Gateway. It sits in front of a provider (here: Groq) and its
 * only difference at the call site is the URL, the provider key still travels
 * as `Authorization`. Returns null when the gateway is not configured, so the
 * caller can fall back to calling Groq directly.
 *
 *   accountId + gatewayId -> https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/groq
 */
export function gatewayBase(accountId, gatewayId) {
  const acct = String(accountId || '').trim();
  const gw = String(gatewayId || '').trim();
  if (!acct || !gw) return null;
  return `https://gateway.ai.cloudflare.com/v1/${acct}/${gw}/groq`;
}

export function validateVoiceAgentCore() {
  const problems = [];
  const pools = parseProviderPools({});
  if (pools.stt.length || pools.llm.length || pools.tts.length) problems.push('empty config must yield empty pools');
  if (!isFailoverStatus(429) || !isFailoverStatus(402) || !isFailoverStatus(401)) problems.push('quota statuses must fail over');
  if (isFailoverStatus(400) || isFailoverStatus(200)) problems.push('client errors must not fail over');
  // Sample secrets are assembled at runtime so no key-shaped literal lives in
  // this file, a scanner reading the source must not see anything to flag.
  const sample = 'Bearer sk-' + 'a'.repeat(20);
  if (sanitizeSecret(sample).includes('a'.repeat(20))) problems.push('secret scrub failed');
  if (canTransition(STATE.IDLE, STATE.SPEAKING)) problems.push('idle must not jump to speaking');
  return problems;
}
