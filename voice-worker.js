/**
 * 🎙️ ADMISSION HUB, Secure Voice Proxy (Cloudflare Worker)
 * v105 · provider-aware: Cartesia (default) with an automatic ElevenLabs fallback
 * generate-once → level-2 server cache → audio to browser
 *
 * ── Deploy (5 মিনিট) ─────────────────────────────────────────────
 * 1. Cloudflare Dashboard → Workers & Pages → Create Worker → নাম দাও (যেমন admission-voice) → Deploy
 * 2. Edit code → এই পুরো ফাইল পেস্ট → Deploy
 * 3. Worker → Settings → Variables & Secrets:
 *      • Add Secret:  CARTESIA_API_KEY = <তোমার Cartesia API key>   (প্রধান)
 *      • Add Secret:  ELEVENLABS_API_KEY = <তোমার ElevenLabs API key> (বিকল্প/fallback)
 *        (key শুধু এখানে থাকবে, অ্যাপ/frontend/localStorage/IndexedDB-তে কখনো নয়)
 * 4. (Optional, level-2 persistent cache) Storage & Databases → KV → Create namespace
 *      → Worker → Settings → Bindings → KV namespace: variable name  VOICE_KV
 * 5. অ্যাপে: Vocabulary → ⚙ Category settings → Vocabulary Voices →
 *      endpoint-এ এই worker-এর URL পেস্ট (যেমন https://admission-voice.<subdomain>.workers.dev)
 *
 * Provider: Cartesia ব্যবহার হয় যখন CARTESIA_API_KEY আছে (অথবা অনুরোধে provider=cartesia);
 * না থাকলে স্বয়ংক্রিয়ভাবে ElevenLabs-এ ফিরে যায়, তাই audio কখনো ভাঙে না।
 *
 * Security: এই worker ছাড়া কেউ কোনো key দেখবে না। Origin allowlist +
 * app-header + per-IP rate limit, যেন অচেনা কেউ তোমার quota পোড়াতে না পারে।
 */

import { allowedOrigin } from './cors-policy.mjs';

const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah, clear American, free-plan API-allowed
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';    // low-latency + cost-efficient
const DEFAULT_FORMAT = 'mp3_22050_32';           // ছোট ফাইল, দ্রুত লোড

/* Cartesia (Sonic). Chosen as the default provider: Bengali on every tier,
   ~4x the audio per dollar at the entry plan, and quality on par with ElevenLabs. */
const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2026-08-14';           // current required API version
const CARTESIA_MODEL = 'sonic-3.6';
const CARTESIA_VOICE_ID = '47c38ca4-5f35-497b-b1a3-415245fb35e1'; // Daniel, clear American male
const CARTESIA_VOICE_ID_BN = 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4'; // Skylar, primary multilingual fallback
const CARTESIA_FORMAT = { container: 'mp3', sample_rate: 44100, bit_rate: 128000 };
const CARTESIA_SPEED = 0.95;                     // slightly slower reads as calmer/clearer
const cleanSpeed = value => { const n = Number(value); return Number.isFinite(n) && n >= 0.6 && n <= 1.5 ? Math.round(n * 100) / 100 : CARTESIA_SPEED; };

const RATE_LIMIT = 60;        // requests / minute / IP
const RATE_WINDOW_MS = 60000;

const rateBuckets = new Map(); // per-isolate best effort (KV ছাড়াই মোটামুটি শক্ত রশ্মি)

/* AI audit 2026-10-16: the allowlist used to accept ANY *.github.io and ANY
   *.pages.dev site, so a stranger's page could spend this TTS quota from a
   visitor's browser. Only the app's own origins (and their preview
   subdomains) are allowed now; a request carrying any other Origin is refused.

   BUG-002 (2026-10-26 audit): localhost / 127.0.0.1 were still accepted here.
   A page served on a developer machine could then make credentialed
   cross-origin calls and read the response with a signed-in student's session.
   Production dropped those on 2026-10-22 (cors-policy.mjs); this copy did not.

   AU-SEC-05 (2026-10-30 audit): the copy still accepted any subdomain of the
   two Pages hosts. The rule now comes from cors-policy.mjs so it cannot drift. */
const originAllowed = allowedOrigin;
const corsHeaders = request => {
  const origin = request.headers.get('Origin') || '';
  /* P20 (v204): pages.dev-ও-অনুমোদিত, আগে ছিল শুধু github.io+localhost, তাই pages.dev-পেজ থেকে
     সরাসরি-ডাক CORS-এ আটকাত। (অ্যাপ-এখন same-origin-প্রক্সি-ব্যবহার-করে; তবু-allowlist-অসম্পূর্ণ-ছিল।) */
  const ok = originAllowed(origin);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-AH-App',
    'Access-Control-Max-Age': '86400'
  };
  if (ok) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};

const json = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request) }
});

const audio = (request, buffer, cacheState) => new Response(buffer, {
  status: 200,
  headers: {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'public, max-age=604800',
    'X-Voice-Cache': cacheState,
    ...corsHeaders(request)
  }
});

const rateLimited = request => {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(ip, hits);
  if (rateBuckets.size > 5000) rateBuckets.clear(); // memory guard
  return hits.length > RATE_LIMIT;
};

const clean = (value, re) => (typeof value === 'string' && re.test(value) ? value : null);

/* Is the text Bengali (so Cartesia should use a bn-capable voice/language)? */
const isBengali = text => /[\u0980-\u09FF]/.test(String(text || ''));

/* The voice actually used for a phrase, needed so the cache key can include it. */
function resolveVoice(word, voiceId) {
  return voiceId || (isBengali(word) ? CARTESIA_VOICE_ID_BN : CARTESIA_VOICE_ID);
}

/* Cartesia → MP3 bytes. Throws on any non-OK response so the caller can fall back. */
async function cartesiaAudio(env, word, voiceId, speed) {
  const bn = isBengali(word);
  const voice = resolveVoice(word, voiceId);
  const resp = await fetch(CARTESIA_URL, {
    method: 'POST',
    headers: {
      'Cartesia-Version': CARTESIA_VERSION,
      'Authorization': `Bearer ${env.CARTESIA_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript: word,
      voice: { id: voice },
      language: bn ? 'bn' : 'en',
      generation_config: { speed: cleanSpeed(speed) },
      output_format: CARTESIA_FORMAT
    })
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = String((await resp.json())?.message || '').slice(0, 160); } catch (_) { /* non-json */ }
    const err = new Error(detail || `cartesia_error_${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const buffer = await resp.arrayBuffer();
  if (!buffer.byteLength) throw new Error('empty_audio');
  return buffer;
}

/* ElevenLabs → MP3 bytes (the fallback path, unchanged behaviour). */
async function elevenAudio(env, word, voiceId, modelId, format) {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${format}`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text: word, // শুধু word, meaning/explanation কখনো audio-তে যায় না
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 }
    })
  });
  if (!resp.ok) {
    let msg = `elevenlabs_error_${resp.status}`;
    try {
      const detail = await resp.json();
      if (detail?.detail?.message) msg = String(detail.detail.message).slice(0, 160);
    } catch (_) { /* non-json error body */ }
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  const buffer = await resp.arrayBuffer();
  if (!buffer.byteLength) throw new Error('empty_audio');
  return buffer;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (url.pathname === '/health') {
      return json(request, {
        ok: true,
        configured: !!(env.CARTESIA_API_KEY || env.ELEVENLABS_API_KEY),
        cartesia: !!env.CARTESIA_API_KEY,
        elevenlabs: !!env.ELEVENLABS_API_KEY,
        provider: env.CARTESIA_API_KEY ? 'cartesia' : (env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'none'),
        kv: !!env.VOICE_KV
      });
    }

    if (request.method !== 'POST' || url.pathname !== '/api/voice') {
      return json(request, { error: 'not_found' }, 404);
    }

    if (!env.CARTESIA_API_KEY && !env.ELEVENLABS_API_KEY) {
      return json(request, { error: 'worker not configured, set CARTESIA_API_KEY secret' }, 503);
    }
    if (request.headers.get('X-AH-App') !== 'admission-hub') {
      return json(request, { error: 'forbidden' }, 403);
    }
    const reqOrigin = request.headers.get('Origin') || '';
    if (reqOrigin && !originAllowed(reqOrigin)) {
      return json(request, { error: 'forbidden_origin' }, 403);
    }
    if (rateLimited(request)) {
      return json(request, { error: 'rate_limited' }, 429);
    }

    let body;
    try { body = await request.json(); } catch (_) { return json(request, { error: 'bad_json' }, 400); }

    const word = String(body?.word || '').trim();
    // \p{M} (combining marks) is required: Bengali vowel signs and conjuncts are
    // marks, not letters, so a letter-only class rejected most Bengali words
    // ("আসসালামু", "কেমন") while accepting bare ones like "বই".
    if (!word || word.length > 60 || !/^[\p{L}][\p{L}\p{M}\u200c\u200d'’.\- ]{0,59}$/u.test(word)) {
      return json(request, { error: 'invalid_word' }, 400);
    }

    // Central config থেকে এলেও worker নিজের whitelist-বিহীন কিছু গ্রহণ করে না
    const voiceId = clean(body.voiceId, /^[a-zA-Z0-9-]{10,40}$/) || null;
    const modelId = clean(body.modelId, /^[a-z0-9_.-]{3,40}$/) || null;
    const format = clean(body.output_format, /^mp3_[0-9_]+$/) || DEFAULT_FORMAT;

    // Which provider? Cartesia when asked for and configured; else the default order.
    const requested = clean(body.provider, /^[a-z]{3,12}$/) || null;
    const useCartesia = !!env.CARTESIA_API_KEY && requested !== 'elevenlabs';
    const provider = useCartesia ? 'cartesia' : 'elevenlabs';

    const norm = word.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/gu, '-').replace(/^-+|-+$/g, '');
    // The key uses the RESOLVED voice, so changing a default voice can never serve
    // the old voice's cached audio. Speed is part of the key for the same reason.
    const resolvedVoice = useCartesia ? resolveVoice(word, clean(voiceId, /^[0-9a-fA-F-]{36}$/)) : (clean(voiceId, /^[a-zA-Z0-9]{10,40}$/) || DEFAULT_VOICE_ID);
    const speed = cleanSpeed(body.speed);
    const cacheKey = `v3:${provider}:${resolvedVoice}:${modelId || 'default'}:${speed}:${norm}`;

    // Level-0 edge cache (Cache API): free, per-colo, does not expire like KV.
    // A repeat play from any student in the same region answers here, so the
    // body never travels and no provider call happens.
    let edgeCache = null;
    let edgeUrl = null;
    try { edgeCache = caches.default; edgeUrl = new URL(request.url); edgeUrl.searchParams.set('v', cacheKey); } catch (_) { edgeCache = null; }
    if (edgeCache && edgeUrl) {
      try {
        const hit = await edgeCache.match(edgeUrl.toString());
        if (hit) {
          const buf = await hit.arrayBuffer();
          if (buf.byteLength > 0) return audio(request, buf, 'edge');
        }
      } catch (_) { /* edge cache unavailable → continue */ }
    }

    // Level-2 cache: server-side, browser storage মুছে গেলেও কোনো TTS কল লাগবে না
    if (env.VOICE_KV) {
      try {
        const hit = await env.VOICE_KV.get(cacheKey, { type: 'arrayBuffer' });
        if (hit && hit.byteLength > 0) {
          if (edgeCache && edgeUrl) { try { await edgeCache.put(edgeUrl.toString(), audio(request, hit, 'miss')); } catch (_) {} }
          return audio(request, hit, 'hit');
        }
      } catch (_) { /* KV না পাওয়া গেলে সরাসরি generate */ }
    }

    // Single-flight lock: two students tapping the same new phrase at once would
    // each pay for it. First writer wins; the second waits briefly, re-checks the
    // cache and only generates if the winner did not store it (best-effort).
    if (env.VOICE_KV) {
      try {
        const lockKey = `lock:${cacheKey}`;
        if (await env.VOICE_KV.get(lockKey)) {
          await new Promise(r => setTimeout(r, 1500));
          const again = await env.VOICE_KV.get(cacheKey, { type: 'arrayBuffer' });
          if (again && again.byteLength > 0) {
            if (edgeCache && edgeUrl) { try { await edgeCache.put(edgeUrl.toString(), audio(request, again, 'miss')); } catch (_) {} }
            return audio(request, again, 'hit');
          }
        } else {
          await env.VOICE_KV.put(lockKey, '1', { expirationTtl: 30 });
        }
      } catch (_) { /* lock is best-effort; generate anyway rather than fail */ }
    }

    const errors = [];
    let buffer = null;
    try {
      if (useCartesia) {
        try {
          // Cartesia voice ids are UUIDs; a legacy ElevenLabs id must not leak in.
          buffer = await cartesiaAudio(env, word, clean(voiceId, /^[0-9a-fA-F-]{36}$/), speed);
        } catch (err) {
          errors.push(`cartesia: ${err.message}`);
          // Fall back to ElevenLabs so a Cartesia outage never silences the app.
          if (env.ELEVENLABS_API_KEY) {
            buffer = await elevenAudio(env, word, clean(voiceId, /^[a-zA-Z0-9]{10,40}$/) || DEFAULT_VOICE_ID, modelId || DEFAULT_MODEL_ID, format);
          } else {
            throw err;
          }
        }
      } else {
        buffer = await elevenAudio(env, word, clean(voiceId, /^[a-zA-Z0-9]{10,40}$/) || DEFAULT_VOICE_ID, modelId || DEFAULT_MODEL_ID, format);
      }
    } catch (err) {
      const status = err.status === 401 || err.status === 403 ? 503 : err.status === 429 ? 429 : 502;
      return json(request, { error: err.message || 'upstream_error', provider, errors }, status);
    }

    if (!buffer || !buffer.byteLength) return json(request, { error: 'empty_audio', provider }, 502);

    if (edgeCache && edgeUrl) {
      try { await edgeCache.put(edgeUrl.toString(), audio(request, buffer, 'miss')); } catch (_) {}
    }

    // Permanence: no expirationTtl, so a phrase is paid for once and stays for
    // the life of the account, every later student is served from the cache.
    if (env.VOICE_KV) {
      try { await env.VOICE_KV.put(cacheKey, buffer); } catch (_) {}
    }
    return audio(request, buffer, 'miss');
  }
};
