/* F0.6 — score a set of answers against the golden set.
 *
 * Kept deliberately separate from the answerer: the answerer will change (a new
 * model, a new prompt) and the yardstick must not move with it. This file only
 * knows how to read a prediction and decide whether it is right.
 *
 * Grading is lenient in the way a student would be, because a correct answer
 * wrapped in a sentence is still correct:
 *   1. exact match after normalisation, or
 *   2. one contains the other (the answer is inside a longer reply), or
 *   3. the answer is close (small edit distance relative to its length), or
 *   4. the reply names an option letter/position that maps to the key.
 * It is NOT lenient about a different answer: a wrong option scores zero.
 *
 * Run: node sky-ai/golden/score.mjs <predictions.json>
 *      predictions = [{ id, answer }] or { id: answer }
 */

const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };

export function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .replace(/[\u200c\u200d]/g, '')
    .replace(/[০-৯]/g, (d) => BN_DIGITS[d])
    .toLowerCase()
    .replace(/[?？!।,.:;"“”‘’'`()[\]{}\-–—_/\\|…*#~<>=+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lev(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const LETTERS = { a: 0, b: 1, c: 2, d: 3, e: 4, 'ক': 0, 'খ': 1, 'গ': 2, 'ঘ': 3, 'ঙ': 4 };

/* A reply may name the option instead of its text ("উত্তর: খ"). Map that back to
   an index so a student answering by letter is not marked wrong. */
export function optionIndexFromLetter(text) {
  const t = normalize(text);
  const m = t.match(/^(?:উত্তর\s*)?([a-eক-ঙ])(?:\s|$)/) || t.match(/\b([a-eক-ঙ])\b/);
  if (!m) return -1;
  const idx = LETTERS[m[1]];
  return idx === undefined ? -1 : idx;
}

export function isCorrect(predicted, item) {
  const p = normalize(predicted);
  if (!p) return false;
  const expected = normalize(item.answer);

  if (p === expected) return true;
  if (expected.length >= 3 && (p.includes(expected) || expected.includes(p))) return true;

  const cap = expected.length >= 9 ? 2 : expected.length >= 5 ? 1 : 0;
  if (cap && lev(p, expected, cap) <= cap) return true;

  const li = optionIndexFromLetter(predicted);
  if (li >= 0) return li === item.answerIndex;
  return false;
}

export function score(predictions, set) {
  const byId = new Map();
  if (Array.isArray(predictions)) for (const r of predictions) byId.set(r.id, r.answer);
  else for (const [id, a] of Object.entries(predictions || {})) byId.set(id, a);

  const perTopic = new Map();
  let correct = 0;
  const misses = [];
  for (const item of set.items) {
    const predicted = byId.get(item.id);
    const ok = predicted != null && isCorrect(predicted, item);
    const t = perTopic.get(item.topic) || { topic: item.topic, total: 0, correct: 0 };
    t.total++;
    if (ok) { correct++; t.correct++; } else if (misses.length < 25) misses.push({ id: item.id, q: item.question, expected: item.answer, got: predicted == null ? null : String(predicted).slice(0, 80) });
    perTopic.set(item.topic, t);
  }

  const answered = set.items.filter((i) => byId.get(i.id) != null).length;
  return {
    set: set.version,
    total: set.items.length,
    answered,
    correct,
    accuracy: +(correct / set.items.length).toFixed(4),
    accuracyOfAnswered: answered ? +(correct / answered).toFixed(4) : 0,
    perTopic: [...perTopic.values()].map((t) => ({ ...t, accuracy: +(t.correct / t.total).toFixed(4) })),
    misses
  };
}

if (process.argv[1] && process.argv[1].endsWith('score.mjs')) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const HERE = dirname(fileURLToPath(import.meta.url));
  const set = JSON.parse(readFileSync(join(HERE, 'golden-set-v1.json'), 'utf8'));
  const preds = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(score(preds, set), null, 2));
}
