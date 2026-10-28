/**
 * 🎙️ P23, LIVE VOICE AGENT · CLIENT CORE
 *
 * The parts of the browser client that are worth testing: where the socket
 * points, what we ask the microphone for, and which container the recorder
 * produces. The UI in voice-agent.html is a shell over these.
 *
 * No DOM and no browser API is touched here, so this runs in node under test.
 */

/* The Worker that answers the voice socket. Kept as a default, not a constant
 * the client is stuck with: a page served from the Worker itself uses its own
 * origin, so the socket survives a rename of the Worker. */
export const DEFAULT_WORKER = 'https://admission-gk.admissionhub.workers.dev';
export const VOICE_PATH = '/api/voice/agent';

/** Is this host served by the Worker itself (so the socket can be relative)? */
export function isSameWorkerOrigin(pageHref, workerUrl = DEFAULT_WORKER) {
  try {
    const page = new URL(pageHref);
    const worker = new URL(workerUrl);
    return page.hostname === worker.hostname;
  } catch (_) {
    return false;
  }
}

/**
 * Can the page reach the socket on its own origin?
 *
 * A page served over http(s) is served alongside the proxy that forwards
 * /api/voice/agent to the Worker (Pages advanced mode, or `wrangler pages dev`),
 * so it should dial itself. This is not just tidiness: the owner gate is a
 * cookie, and a browser only sends a cookie to the origin that set it. A page on
 * Pages dialling the Worker directly would carry no cookie and be refused.
 */
function canUsePageOrigin(pageHref) {
  try {
    const p = new URL(pageHref).protocol;
    return p === 'http:' || p === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Resolve the WebSocket URL for the voice session.
 *
 * Same origin first, so the session cookie travels with the socket; a non-http
 * page (file://, an opaque origin) falls back to the configured Worker. An
 * explicit override still wins, so a staging Worker can be pointed at without a
 * code change.
 */
export function resolveEndpoint(pageHref, workerUrl = DEFAULT_WORKER, override = '') {
  const base = override || workerUrl || DEFAULT_WORKER;
  let origin;
  if (override) {
    origin = base;
  } else if (canUsePageOrigin(pageHref) || isSameWorkerOrigin(pageHref, base)) {
    try { origin = new URL(pageHref).origin; } catch (_) { origin = base; }
  } else {
    origin = base;
  }
  return toSocketUrl(base, origin);
}

/** The HTTP URL the page calls to get a ticket, and the socket URL it then uses.
 *  Both come from one place so they cannot drift apart. */
function toSocketUrl(base, origin) {
  let sock;
  try { sock = new URL(VOICE_PATH, origin); } catch (_) { sock = new URL(VOICE_PATH, DEFAULT_WORKER); }
  sock.protocol = sock.protocol === 'https:' ? 'wss:' : 'ws:';
  return sock.toString();
}

/** Where to POST for a ticket. Same origin resolution as the socket. */
export function resolveTicketUrl(pageHref, workerUrl = DEFAULT_WORKER, override = '') {
  const base = override || workerUrl || DEFAULT_WORKER;
  let origin;
  if (override) {
    origin = base;
  } else if (canUsePageOrigin(pageHref) || isSameWorkerOrigin(pageHref, base)) {
    try { origin = new URL(pageHref).origin; } catch (_) { origin = base; }
  } else {
    origin = base;
  }
  try { return new URL(VOICE_PATH + '/ticket', origin).toString(); }
  catch (_) { return new URL(VOICE_PATH + '/ticket', DEFAULT_WORKER).toString(); }
}

/** Attach the single-use ticket to the socket URL. */
export function withTicket(socketUrl, ticket) {
  try {
    const u = new URL(socketUrl);
    if (ticket) u.searchParams.set('ticket', String(ticket));
    return u.toString();
  } catch (_) { return socketUrl; }
}

/** Headers the ticket request must carry. The app header is the gate the
 *  existing voice worker already uses, so both agree. */
export function ticketHeaders(accessToken = '') {
  const h = { 'Content-Type': 'application/json', 'X-AH-App': 'admission-hub' };
  if (accessToken) h['X-Voice-Token'] = String(accessToken);
  return h;
}

/** Microphone constraints. One channel, and the three filters that make a phone
 *  conversation bearable: echo cancellation, noise suppression, auto gain. */
export function micConstraints() {
  return {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

/* Container preference, best first. Opus-in-WebM is what every provider we call
 * transcribes most reliably; mp4 is the Safari path. */
export const MIME_PREFERENCE = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]);

/**
 * Choose a recorder container from what the browser says it supports.
 * Returns null when nothing matches, the caller must handle that rather than
 * hand MediaRecorder an unsupported type.
 */
export function pickMime(supported) {
  const list = Array.isArray(supported) ? supported : [];
  const has = (m) => list.some(s => String(s).split(';')[0].trim() === m.split(';')[0].trim() && (s === m || m.includes(';') === s.includes(';')));
  for (const m of MIME_PREFERENCE) {
    if (has(m)) return m;
  }
  // Fall back to a prefix match: some browsers report the codec-less form only.
  for (const m of MIME_PREFERENCE) {
    const base = m.split(';')[0];
    if (list.some(s => String(s).startsWith(base))) return base;
  }
  return null;
}

/* Client-side session phases. Mirrors the server's, but the client owns its own
 * so the button can react before the server answers. */
export const PHASE = Object.freeze({
  OFFLINE: 'offline',
  READY: 'ready',
  RECORDING: 'recording',
  WAITING: 'waiting',
  SPEAKING: 'speaking',
  ERROR: 'error',
});

/** Bytes -> base64 for the socket payload. */
export function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Human-readable label for a phase, the text on the button. */
export function phaseLabel(phase) {
  return {
    [PHASE.OFFLINE]: 'সংযোগ নেই',
    [PHASE.READY]: 'চাপ দিয়ে বলুন',
    [PHASE.RECORDING]: 'শুনছি… থামাতে চাপ দিন',
    [PHASE.WAITING]: 'ভাবছি…',
    [PHASE.SPEAKING]: 'বলছি…',
    [PHASE.ERROR]: 'সমস্যা হয়েছে',
  }[phase] || '';
}

/** A short, honest latency line: only shows stages that were measured. */
export function formatLatency(ms) {
  if (!ms || typeof ms !== 'object') return '';
  const parts = [];
  if (Number.isFinite(ms.stt)) parts.push(`শোনা ${Math.round(ms.stt)}ms`);
  if (Number.isFinite(ms.llm)) parts.push(`ভাবা ${Math.round(ms.llm)}ms`);
  if (Number.isFinite(ms.tts)) parts.push(`কণ্ঠ ${Math.round(ms.tts)}ms`);
  if (Number.isFinite(ms.total)) parts.push(`মোট ${(ms.total / 1000).toFixed(1)}s`);
  return parts.join(' · ');
}

export function validateVoiceClientCore() {
  const problems = [];
  if (!resolveEndpoint('https://admissionhub.pages.dev/').startsWith('wss://')) problems.push('pages must dial wss');
  if (resolveEndpoint('https://admission-gk.admissionhub.workers.dev/') !== 'wss://admission-gk.admissionhub.workers.dev/api/voice/agent') problems.push('same-origin must stay relative');
  if (pickMime(['audio/webm']) !== 'audio/webm') problems.push('webm must be picked');
  if (pickMime([]) !== null) problems.push('no support must be null');
  if (micConstraints().audio.channelCount !== 1) problems.push('mono must be requested');
  return problems;
}
