/**
 * 🎙️ P23, LIVE VOICE AGENT · PROVIDER ADAPTERS
 *
 * One function per provider, each returning a normalised result. Every adapter
 * takes an injectable `fetch` so the pool can be tested without a network.
 *
 * Rules that hold across every adapter:
 *  • A non-OK response throws an Error carrying `.status`, so the failover
 *    runner can decide whether to move on. Adapters never swallow a status.
 *  • No adapter logs or returns a credential.
 *  • STT/TTS work in Bengali; the language is stated, not guessed, wherever the
 *    provider takes a parameter.
 */

import { sanitizeSecret } from './voice-agent-core.mjs';

const ok = (r) => r && typeof r.ok === 'boolean' ? r.ok : false;

/* The model the owner asked for. Kept as a named constant so it appears in one
 * place; a pool entry can still override it with `model`. */
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-5.6-luna';

async function statusError(res, fallback) {
  let detail = '';
  try { detail = String((await res.json())?.error?.message || (await res.json())?.message || ''); } catch (_) { /* non-json */ }
  const err = new Error(sanitizeSecret(detail || `${fallback}_${res.status}`).slice(0, 200));
  err.status = res.status;
  return err;
}

/* ── Speech → text ──────────────────────────────────────────────────────── */

/**
 * Whisper conditions strongly on this. Without it, Bengali came back mangled in
 * testing on even a clean synthetic clip, "আসসালামু আলাইকুম" was heard as
 * "আশ্যারমো আলাইকুম", which is the owner's "আমার কথা অস্পষ্ট" complaint. The
 * word "বাংলা" plus a couple of everyday phrases pins the script and accent, so
 * the same clip transcribes correctly. Capped so it cannot dominate a long turn.
 */
export const BN_STT_PROMPT = 'বাংলা কথ্য ভাষা। হ্যালো আসসালামু আলাইকুম, আপনি কেমন আছেন? আমি ভালো আছি, ধন্যবাদ।';

/** Groq Whisper. Multipart upload of the recorded clip. */
export async function groqStt(provider, audio, opts = {}) {
  const f = opts.fetch || fetch;
  const form = new FormData();
  form.append('file', new Blob([audio], { type: opts.mime || 'audio/webm' }), 'clip.webm');
  form.append('model', provider.model || 'whisper-large-v3');
  form.append('language', opts.language || 'bn');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (opts.prompt !== null) form.append('prompt', String(opts.prompt || BN_STT_PROMPT).slice(0, 800));
  const res = await f('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}` },
    body: form,
  });
  if (!ok(res)) throw await statusError(res, 'groq_stt');
  const data = await res.json();
  return { text: String(data.text || '').trim(), provider: provider.id };
}

/** Deepgram. Raw audio body with the content type in a header. */
export async function deepgramStt(provider, audio, opts = {}) {
  const f = opts.fetch || fetch;
  const params = new URLSearchParams({ model: provider.model || 'nova-3', language: opts.language || 'bn', smart_format: 'true' });
  const res = await f(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${provider.key}`, 'Content-Type': opts.mime || 'audio/webm' },
    body: audio,
  });
  if (!ok(res)) throw await statusError(res, 'deepgram_stt');
  const data = await res.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  return { text: String(alt?.transcript || '').trim(), provider: provider.id };
}

/** Gemini. Inline base64 audio, the same path the relay already uses. */
export async function geminiStt(provider, audio, opts = {}) {
  const f = opts.fetch || fetch;
  const b64 = opts.base64 || base64From(audio);
  // gemini-3.8-flash 429s and 3.7-flash 503s on this key; 3.5-flash-lite was the
  // one model that answered Bengali reliably, so it is the default rather than a
  // nominal stronger one that leaves the fallback dead.
  const model = provider.model || 'gemini-3.5-flash-lite';
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'এই অডিওটি বাংলায় হুবহু লিখে দাও। শুধু লেখাটা দাও, আর কিছু নয়।' },
        { inline_data: { mime_type: opts.mime || 'audio/webm', data: b64 } },
      ] }],
    }),
  });
  if (!ok(res)) throw await statusError(res, 'gemini_stt');
  const data = await res.json();
  return { text: String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(), provider: provider.id };
}

/* base64 without Buffer, so the same code runs in a Worker and in node tests. */
function base64From(audio) {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* The reverse. Gemini's voice reply arrives as base64 PCM, and node has no atob
 * in every context, so this does not depend on one. */
function fromBase64(b64) {
  const bin = atob(String(b64));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Text → text ────────────────────────────────────────────────────────── */

/** OpenAI-compatible chat completion, shared by Groq, OpenRouter and the gateway. */
async function openAiChat(url, provider, messages, opts, fallbackName) {
  const f = opts.fetch || fetch;
  const system = opts.system ? String(opts.system) : '';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` };
  // An Authenticated Gateway needs its own token, separate from the provider key.
  if (provider.gatewayToken) headers['cf-aig-authorization'] = `Bearer ${provider.gatewayToken}`;
  const body = {
    model: provider.model || opts.defaultModel,
    // The persona and the relevance rules ride in the system turn. Without
    // this the OpenAI-compatible providers answered with no instructions at
    // all, the reason replies drifted off-topic.
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    temperature: opts.temperature == null ? 0.6 : opts.temperature,
    max_tokens: opts.maxTokens || 400,
  };
  // Reasoning models (gpt-oss, qwen3) otherwise spend the whole token budget on
  // hidden reasoning and return empty content. Low effort keeps them answering.
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  const res = await f(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!ok(res)) throw await statusError(res, fallbackName);
  const data = await res.json();
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  // A reasoning model can still answer entirely inside `reasoning`. One retry
  // with a bigger budget beats handing the owner a silent turn.
  if (!text && data?.choices?.[0]?.message?.reasoning && !opts._retried) {
    return openAiChat(url, provider, messages, { ...opts, maxTokens: (opts.maxTokens || 400) * 3, _retried: true }, fallbackName);
  }
  return { text, provider: provider.id };
}

export function groqLlm(provider, messages, opts = {}) {
  // `provider.url` points at the Cloudflare AI Gateway when it is configured,
  // otherwise at Groq directly. Same request either way.
  const url = provider.url || 'https://api.groq.com/openai/v1/chat/completions';
  return openAiChat(url, provider, messages,
    { defaultModel: 'openai/gpt-oss-120b', reasoningEffort: 'low', ...opts }, 'groq_llm');
}

export function openrouterLlm(provider, messages, opts = {}) {
  // Default to the owner's chosen model (gpt-5.6-luna); a pool entry can still
  // override it with `model`.
  return openAiChat('https://openrouter.ai/api/v1/chat/completions', provider, messages,
    { defaultModel: OPENROUTER_DEFAULT_MODEL, ...opts }, 'openrouter_llm');
}

/**
 * Any OpenAI-compatible chat endpoint, OpenAI, OpenRouter, or Cloudflare AI
 * Gateway, with the URL carried on the provider entry so the owner can point
 * it at a stronger model (Claude, GPT, Gemini) without a code change.
 *
 *   [{"id":"openai-compat","key":"...","model":"anthropic/claude-sonnet-4-5",
 *     "url":"https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/compat/chat/completions"}]
 *
 * AI Gateway speaks exactly this dialect, so switching a call to route through
 * it is a URL change, not an adapter change.
 */
export function openaiCompatLlm(provider, messages, opts = {}) {
  const url = provider.url || opts.baseUrl;
  if (!url) { const e = new Error('openai_compat_needs_url'); e.status = 500; throw e; }
  return openAiChat(url, provider, messages,
    { defaultModel: opts.defaultModel || '', ...opts }, 'openai_compat_llm');
}

/** Gemini chat. The system prompt goes in system_instruction, history as turns. */
export async function geminiLlm(provider, messages, opts = {}) {
  const f = opts.fetch || fetch;
  // gemini-3.8-flash returns 429 for this key; the lite model answered, so the
  // fallback chain leads with the one that actually serves rather than 429ing
  // through to Groq.
  const model = provider.model || 'gemini-3.5-flash-lite';
  const system = opts.system || '';
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
    body: JSON.stringify({
      ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature: opts.temperature == null ? 0.6 : opts.temperature, maxOutputTokens: opts.maxTokens || 400 },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'gemini_llm');
  const data = await res.json();
  return { text: String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(), provider: provider.id };
}

/* ── Text → speech ──────────────────────────────────────────────────────── */

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2026-08-14';
/**
 * "Rubel – City Guide", the Bengali MASCULINE voice the owner asked for by
 * name. The previous default was a feminine voice, which he rejected.
 */
const CARTESIA_VOICE_BN = '2ba861ea-7cdc-43d1-8608-4045b5a41de5';

/** Cartesia Sonic. Returns MP3 bytes. Used for both pool slots. */
export async function cartesiaTts(provider, text, opts = {}) {
  const f = opts.fetch || fetch;
  const res = await f(CARTESIA_URL, {
    method: 'POST',
    headers: {
      'Cartesia-Version': CARTESIA_VERSION,
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: provider.model || 'sonic-3.6',
      transcript: text,
      voice: { id: provider.voiceId || opts.voiceId || CARTESIA_VOICE_BN },
      language: opts.language || 'bn',
      generation_config: { speed: opts.speed || 0.95 },
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'cartesia_tts');
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) { const e = new Error('empty_audio'); e.status = 502; throw e; }
  return { audio: buf, mime: 'audio/mpeg', provider: provider.id };
}

/**
 * Wrap raw PCM in a WAV container.
 *
 * Gemini's voice models return headerless 16-bit mono PCM, which a browser
 * cannot play. 44 bytes of RIFF header turns it into something `new Audio()`
 * accepts, with no audio library and no dependency.
 */
export function pcmToWav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const blockAlign = channels * bits / 8;
  const out = new Uint8Array(44 + bytes.length);
  const view = new DataView(out.buffer);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, bytes.length, true);
  out.set(bytes, 44);
  return out;
}

/**
 * Gemini voice (the TTS preview models). Returns WAV bytes.
 *
 * This is the only TTS path that needs no new credential, it rides the same
 * Gemini keys already bound for the LLM, so the agent can speak on a
 * deployment where Cartesia is not configured.
 */
export async function geminiTts(provider, text, opts = {}) {
  const f = opts.fetch || fetch;
  const model = provider.model || 'gemini-3.8-flash-tts';
  const voice = provider.voiceId || opts.voiceId || 'Kore';
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'gemini_tts');
  const data = await res.json();
  const inline = data && data.candidates && data.candidates[0]
    && data.candidates[0].content && data.candidates[0].content.parts
    && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].inlineData;
  if (!inline || !inline.data) { const e = new Error('empty_audio'); e.status = 502; throw e; }
  const pcm = fromBase64(inline.data);
  const rate = Number((/rate=(\d+)/.exec(inline.mimeType || '') || [])[1]) || 24000;
  if (!pcm.length) { const e = new Error('empty_audio'); e.status = 502; throw e; }
  return { audio: pcmToWav(pcm, rate), mime: 'audio/wav', provider: provider.id };
}

/** ElevenLabs. The fallback voice. */
export async function elevenTts(provider, text, opts = {}) {
  const f = opts.fetch || fetch;
  const voiceId = provider.voiceId || opts.voiceId || 'EXAVITQu4vr4xnSDxMaL';
  const format = opts.format || 'mp3_22050_32';
  const res = await f(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': provider.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: provider.model || 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'elevenlabs_tts');
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) { const e = new Error('empty_audio'); e.status = 502; throw e; }
  return { audio: buf, mime: 'audio/mpeg', provider: provider.id };
}

/* ── Dispatch tables ────────────────────────────────────────────────────── */

export const STT = { 'groq-whisper': groqStt, deepgram: deepgramStt, 'gemini-stt': geminiStt };
export const LLM = { 'groq-llama': groqLlm, openrouter: openrouterLlm, 'gemini-llm': geminiLlm, 'openai-compat': openaiCompatLlm };
export const TTS = { cartesia: cartesiaTts, 'cartesia-2': cartesiaTts, elevenlabs: elevenTts, 'gemini-tts': geminiTts };

export function pickAdapter(table, provider) {
  const fn = table[provider && provider.id];
  if (!fn) { const e = new Error('unknown_provider:' + (provider && provider.id)); e.status = 500; throw e; }
  return fn;
}
