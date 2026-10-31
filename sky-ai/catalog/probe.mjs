/* ML-06 — the model prober: MEASURE a provider, never assume it.
 *
 * Page ০৬'s rule is "অনুমানে কোনো সংখ্যা লেখা হবে না" (no number from
 * guesswork). A prober is how a number stops being a guess: it calls the real
 * endpoint and records what came back.
 *
 * It answers two questions per provider, and keeps them separate because they
 * fail differently:
 *
 *   1. REACHABLE? A one-token call. A 401/403 means the credential is bad (or,
 *      as seen here, the sandbox IP is blocked); a 429 means rate-limited, which
 *      is NOT the same as broken — the model is fine, this minute is not.
 *   2. BANGLA SCORE? The same MCQ the student sees, on a sample of the F0.6
 *      golden set, scored with the F0.6 scorer. That makes `banglaScore` a
 *      measurement comparable across providers rather than a vibe.
 *
 * Usage:
 *   node sky-ai/catalog/probe.mjs [--sample 20] [--out research-<date>.json]
 *
 * It writes a research file; it never edits models.mjs. Filling the catalog is a
 * separate, reviewable step (apply-research.mjs) so a measurement and a decision
 * to trust it are not the same commit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOG } from './models.mjs';
import { score } from '../golden/score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SAMPLE = parseInt(flag('sample', '20'), 10);
const OUT = flag('out', join(HERE, `research-${new Date().toISOString().slice(0, 10)}.json`));

const golden = JSON.parse(readFileSync(join(HERE, '..', 'golden', 'golden-set-v1.json'), 'utf8'));
/* Deterministic sample: every Nth item, so two runs on the same day are
   comparable and a provider is never judged on a lucky subset. */
const step = Math.max(1, Math.floor(golden.items.length / SAMPLE));
const sample = golden.items.filter((_, i) => i % step === 0).slice(0, SAMPLE);

/* Which env var holds each catalog key. The catalog stores the NAME the live
   Worker binds; a local run has the same value under a *_API_KEY alias. */
const ENV_ALIASES = {
  GEMINI_KEYS: ['GEMINI_KEYS', 'GEMINI_API_KEY', 'GEMINI_NEW_API_KEY'],
  GROQ_API_KEY: ['GROQ_API_KEY', 'GROQ_NEW_API_KEY'],
  OPENROUTER_API_KEYS: ['OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY'],
  MISTRAL_API_KEYS: ['MISTRAL_API_KEYS', 'MISTARAL_NEW_API_KEY', 'MISTRAL_API_KEY'],
  CEREBRAS_API_KEYS: ['CEREBRAS_API_KEYS', 'CEREBRAS_API_KEY'],
  TOGETHER_API_KEYS: ['TOGETHER_API_KEYS', 'TOGETHER_API_KEY'],
  CLOUDFLARE_AI_API_KEY: ['CLOUDFLARE_AI_API_KEY'],
  GITHUB_MODELS_TOKEN: ['GITHUB_MODELS_TOKEN'],
  COHERE_API_KEYS: ['COHERE_API_KEYS'],
  SAMBANOVA_API_KEYS: ['SAMBANOVA_API_KEYS'],
  HUGGINGFACE_API_KEYS: ['HUGGINGFACE_API_KEYS'],
  DEEPINFRA_API_KEYS: ['DEEPINFRA_API_KEYS'],
  KIMI_API_KEYS: ['KIMI_API_KEYS'],
  AIML_API_KEYS: ['AIML_API_KEYS'],
  LLM7_API_KEYS: ['LLM7_API_KEYS'],
  SILICONFLOW_API_KEYS: ['SILICONFLOW_API_KEYS'],
  STEPFUN_API_KEYS: ['STEPFUN_API_KEYS'],
  MINIMAX_API_KEYS: ['MINIMAX_API_KEYS'],
  VERCEL_AI_GATEWAY_KEY: ['VERCEL_AI_GATEWAY_KEY'],
};

function keyFor(entry) {
  for (const name of ENV_ALIASES[entry.key] || [entry.key]) {
    const v = process.env[name];
    if (v && String(v).trim()) return { name, value: String(v).split(',')[0].trim() };
  }
  return null;
}

function promptFor(item) {
  const opts = item.options.map((o, i) => `${'কখগঘ'[i] || i + 1}. ${o}`).join('\n');
  return `${item.question}\n${opts}\n\nসঠিক উত্তরটি শুধু এক লাইনে লেখো।`;
}

async function chat(entry, key, model, messages, maxTokens) {
  const url = entry.adapter === 'gemini'
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    : entry.adapter === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : entry.url;
  const isGemini = entry.adapter === 'gemini';
  const body = isGemini
    ? { contents: messages.map((m) => ({ parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens } }
    : { model, messages, max_tokens: maxTokens };
  const headers = { 'Content-Type': 'application/json' };
  if (!isGemini) headers.Authorization = `Bearer ${key}`;
  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  const raw = await res.text();
  let text = '';
  try {
    const j = JSON.parse(raw);
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    text = isGemini
      ? (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || []).map((p) => p.text || '').join('')
      : (msg && msg.content) || '';
    /* A reasoning model (gpt-oss, deepseek-r1, ...) can spend the whole budget
       on its `reasoning` field and return an EMPTY content string. That is not
       a wrong answer, it is a truncated one — scoring it as wrong would libel
       the model. Fall back to the reasoning text so the answer is still read. */
    if (!text && msg && msg.reasoning) text = String(msg.reasoning);
    if (!text && j.error) text = '__error__:' + (j.error.message || JSON.stringify(j.error)).slice(0, 120);
  } catch { text = ''; }
  return { status: res.status, ms, text, raw: raw.slice(0, 200) };
}

const out = {
  probedAt: new Date().toISOString(),
  sampleSize: sample.length,
  goldenSet: golden.version,
  providers: {},
};

for (const entry of CATALOG) {
  const k = keyFor(entry);
  const rec = { keyName: entry.key, keyPresent: !!k, adapter: entry.adapter, model: entry.models[0] };
  if (!k) { rec.reachable = null; rec.note = 'no credential in this environment'; out.providers[entry.id] = rec; console.log(`${entry.id.padEnd(20)} no key`); continue; }
  rec.keyEnv = k.name;
  try {
    const ping = await chat(entry, k.value, entry.models[0], [{ role: 'user', content: 'hi' }], 1);
    rec.reachable = ping.status === 200;
    rec.httpStatus = ping.status;
    rec.latencyMs = ping.ms;
    if (!rec.reachable) {
      rec.errorSample = (ping.text || ping.raw).slice(0, 160);
      /* 429/503 say 'not this minute', not 'broken'. Marking them transient
         keeps a temporary spike from being written into the catalog as a
         permanent verdict about the provider. */
      rec.transient = ping.status === 429 || ping.status === 503;
    }
    console.log(`${entry.id.padEnd(20)} HTTP ${ping.status} ${ping.ms}ms`);
  } catch (e) {
    rec.reachable = false; rec.httpStatus = 0; rec.errorSample = String(e).slice(0, 160);
    console.log(`${entry.id.padEnd(20)} threw ${String(e).slice(0, 80)}`);
  }
  if (rec.reachable) {
    const preds = {};
    let ok = 0;
    for (const item of sample) {
      try {
        const r = await chat(entry, k.value, entry.models[0], [{ role: 'user', content: promptFor(item) }], 1500);
        preds[item.id] = r.text || '__error__:empty';
        if (r.text && !String(r.text).startsWith('__error__')) ok++;
      } catch { preds[item.id] = '__error__:threw'; }
      await new Promise((r) => setTimeout(r, 250));
    }
    const s = score(preds, { ...golden, items: sample });
    rec.banglaScore = { correct: s.correct, total: sample.length, accuracy: s.accuracy, answered: ok };
    console.log(`   bangla: ${s.correct}/${sample.length} = ${(s.accuracy * 100).toFixed(1)}%`);
  }
  out.providers[entry.id] = rec;
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\nwrote ${OUT}`);
