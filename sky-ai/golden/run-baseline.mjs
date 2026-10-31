/* F0.6 — run the golden set through the REAL chat path and score it.
 *
 * This calls the same `agentChat` the student's app calls, so the number is a
 * measurement of what a student would actually get — not of a toy prompt built
 * only for the test. Memory persistence is OFF and the uid is a fixed eval
 * account, so a run cannot write into a real student's history or quota.
 *
 * Resumable: every answer is appended to the predictions file as it arrives, so
 * a run that dies at item 150 can be restarted and only the missing items are
 * asked again. 205 model calls is a real cost; re-asking them would be waste.
 *
 * Run: node sky-ai/golden/run-baseline.mjs [--limit N] [--concurrency N] [--out FILE]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { agentChat } from '../../ai-agent.js';
import { score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const LIMIT = parseInt(flag('limit', '0'), 10) || Infinity;
const CONC = parseInt(flag('concurrency', '4'), 10);
const OUT = flag('out', join(HERE, 'baseline-v1.predictions.json'));
const MODEL_LABEL = flag('model', 'default');

const set = JSON.parse(readFileSync(join(HERE, 'golden-set-v1.json'), 'utf8'));
const preds = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
/* An errored prediction is NOT done -- a rate-limited run must be able to
   re-ask it, or a transient 429 would freeze a wrong score into the baseline. */
const done = new Set(Object.keys(preds).filter((k) => !String(preds[k]).startsWith('__error__')));

/* The prompt is the one a student would type: the question plus the options,
   nothing that hints at the format of the answer key. */
function promptFor(item) {
  const opts = item.options.map((o, i) => `${'কখগঘ'[i] || i + 1}. ${o}`).join('\n');
  return `${item.question}\n${opts}\n\nসঠিক উত্তরটি শুধু এক লাইনে লেখো।`;
}

async function ask(item) {
  const env = { GEMINI_KEYS: process.env.GEMINI_KEYS || process.env.GEMINI_API_KEY };
  const req = new Request('https://eval.local/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: promptFor(item) }] })
  });
  const res = await agentChat(req, env, 'account-golden-eval', {
    stream: false, persistMemory: false, reqId: `golden-${item.id}`
  });
  const j = await res.json().catch(() => ({}));
  return j.text || (j.error ? `__error__:${j.error}` : '');
}

const todo = set.items.filter((i) => !done.has(i.id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`golden baseline: ${done.size} already done, ${todo.length} to ask, concurrency ${CONC}`);

let idx = 0, ok = 0, failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function worker() {
  while (idx < todo.length) {
    const item = todo[idx++];
    let text = '';
    for (let attempt = 0; attempt < 2 && !text; attempt++) {
      try { text = await ask(item); } catch (e) { text = ''; }
    }
    if (!text) { failed++; text = '__error__:no_answer'; } else ok++;
    preds[item.id] = text;
    writeFileSync(OUT, JSON.stringify(preds, null, 1) + '\n');
    await sleep(350);
    if ((ok + failed) % 20 === 0) console.log(`  ...${ok + failed}/${todo.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const result = score(preds, set);
result.model = MODEL_LABEL;
result.runAt = new Date().toISOString();
result.answered = set.items.filter((i) => preds[i.id] && !String(preds[i.id]).startsWith('__error__')).length;
writeFileSync(join(HERE, `baseline-v1.${MODEL_LABEL}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ total: result.total, answered: result.answered, correct: result.correct, accuracy: result.accuracy }, null, 2));
console.log('per-topic:', JSON.stringify(result.perTopic));
console.log(`wrote ${join(HERE, `baseline-v1.${MODEL_LABEL}.json`)}`);
