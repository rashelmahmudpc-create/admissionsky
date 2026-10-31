/* F0.6 — build the golden set from the real question bank.
 *
 * The set is SAMPLED, not written by hand, for one reason: every expected answer
 * here is a human-checked answer key that already ships in `mcq_final.json`. A
 * hand-written set would encode what we HOPE the AI says; this one encodes what
 * the course actually teaches, so a score against it means something.
 *
 * Sampling is deterministic (even spacing per topic), so re-running this file
 * reproduces the same 205 items byte for byte. A golden set that drifts on every
 * run cannot be used to compare two models.
 *
 * Run: node sky-ai/golden/build-set.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PER_TOPIC = 41;

const bank = JSON.parse(readFileSync(join(ROOT, 'mcq_final.json'), 'utf8')).questions;
const byTopic = new Map();
for (const q of bank) {
  if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
  byTopic.get(q.topic).push(q);
}

const items = [];
for (const topic of [...byTopic.keys()].sort()) {
  const rows = byTopic.get(topic);
  const n = Math.min(PER_TOPIC, rows.length);
  const step = rows.length / n;
  for (let i = 0; i < n; i++) {
    const q = rows[Math.floor(i * step)];
    items.push({
      id: q.id,
      topic,
      question: q.question,
      options: q.options,
      answer: q.options[q.answer],
      answerIndex: q.answer,
      source: q.source
    });
  }
}

const set = {
  version: 'golden-v1',
  builtFrom: 'mcq_final.json',
  note: 'Sampled deterministically, evenly per topic. Every expected answer is the shipped answer key.',
  topics: [...byTopic.keys()].sort().map((t) => ({ topic: t, inBank: byTopic.get(t).length })),
  count: items.length,
  items
};

writeFileSync(join(HERE, 'golden-set-v1.json'), JSON.stringify(set, null, 2) + '\n');
console.log(`golden-set-v1: ${items.length} items across ${byTopic.size} topics`);
