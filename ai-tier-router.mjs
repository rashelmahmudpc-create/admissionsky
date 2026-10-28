/**
 * P26, difficulty-aware tier routing (step 2 of the owner's AI cost plan).
 *
 * THE PROBLEM
 * -----------
 * `classifyIntent` sends every academic question to the SMART model
 * (`gemini-3-flash-preview`), on the assumption that "academic means hard".
 * Measured against the real classifier, that is not true: "নিউটনের দ্বিতীয়
 * সূত্র কী?" and "বাংলাদেশের রাজধানী কোনটি?" are academic by the regex and
 * simple by any human reading. They were paying the SMART rate for an answer
 * the FAST model gives just as well, and every provider here is on a free
 * tier, so the real cost is quota spent on questions that did not need it.
 *
 * THE RULE
 * --------
 * Downgrade SMART to FAST only when the question is *provably* simple, and
 * never upgrade. Two consequences that matter:
 *
 *   - A misjudged simple question still gets a correct answer; it just costs
 *     less. A misjudged hard one would lose quality, so the hard markers below
 *     are deliberately generous: anything with comparison, causation, a proof,
 *     a derivation, a calculation or step-by-step wording stays on SMART.
 *   - Never upgrading means this can only ever reduce spend. It cannot quietly
 *     raise the bill on a question the old classifier would have sent to FAST.
 *
 * This is a routing change, not a prompt change: the system prompt, the model
 * chain order and the failover behaviour are all untouched.
 */

export const DIFFICULTY = Object.freeze({ SIMPLE: 'simple', COMPLEX: 'complex' });

/* Any one of these means the question asks for reasoning the cheap model is
 * measurably worse at, so it keeps the SMART tier regardless of length.
 *
 * NOTE: `\b` is ASCII-only in JS, so it never matches after a Bengali letter
 * (Bengali letters are not \w). A Bengali marker must use (?!\p{L}) with the `u`
 * flag instead, `/কেন\b/` silently never fired, which let "সালোকসংশ্লেষণ কেন
 * হয়?" fall through to FAST. */
const HARD_MARKERS = [
  /পার্থক্য|তুলনা|তুলনামূলক/u, // compare / contrast
  /\bdifference\b|\bcompare\b|\bcontrast\b|\bversus\b|\bvs\.?\b/,
  /কেন(?![\p{L}\p{M}])|কী কারণে|কারণ কী/u, // why / for what reason
  /\bwhy\b|\bexplain why\b/,
  /প্রমাণ|সিদ্ধ/u, // prove
  /\bprove\b|\bderive\b|\bderivation\b/,
  /বের করো|গণনা|হিসাব করো|সমাধান করো/u, // calculate / solve
  /\bcalculate\b|\bcompute\b|\bsolve\b/,
  /ধাপে ধাপে|স্তরে স্তরে|পদক্ষেপ/u, // step by step
  /\bstep by step\b|\bstep-by-step\b|\bshow your work\b/,
  /এবং|তারপর|তার সাথে|পাশাপাশি/u, // multi-part conjunctions
  /\bexplain in detail\b|\bin detail\b|\belaborate\b/
];

/* A question this long is a multi-part or essay-style ask even without a marker. */
const SIMPLE_MAX_WORDS = 14;

/** Human-readable reason for a routing decision, so a log or trace can explain it. */
export function assessDifficulty(text) {
  const raw = String(text == null ? '' : text);
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return { level: DIFFICULTY.COMPLEX, reason: 'empty' };

  const words = t.split(' ').filter(Boolean);
  if (words.length > SIMPLE_MAX_WORDS) {
    return { level: DIFFICULTY.COMPLEX, reason: 'long:' + words.length };
  }
  /* Two or more question marks is a multi-part ask ("... কী? আর ... কেন?"). */
  const marks = (raw.match(/[?？]/g) || []).length;
  if (marks > 1) return { level: DIFFICULTY.COMPLEX, reason: 'multi-part' };

  for (const re of HARD_MARKERS) {
    if (re.test(t)) return { level: DIFFICULTY.COMPLEX, reason: 'marker:' + re.source.slice(0, 24) };
  }
  return { level: DIFFICULTY.SIMPLE, reason: 'short-single' };
}

/**
 * Apply the difficulty rule to an intent's tier.
 *
 * Only a SIMPLE academic or performance question drops from SMART to FAST.
 * Everything else is returned unchanged, including every FAST tier, so this
 * function provably never spends more than the caller would have.
 */
export function routeTier(intent, text, baseTier) {
  const tier = String(baseTier || '');
  if (tier !== 'SMART') return { tier, downgraded: false, reason: 'not-smart' };
  /* Only these two intents are worth reconsidering; a quiz or a personal
   * performance report keeps its tier untouched. */
  if (intent !== 'ACADEMIC_EXPLAIN') return { tier, downgraded: false, reason: 'intent-kept' };
  const d = assessDifficulty(text);
  if (d.level !== DIFFICULTY.SIMPLE) return { tier, downgraded: false, reason: d.reason };
  return { tier: 'FAST', downgraded: true, reason: d.reason };
}

export const __tierTest = Object.freeze({ HARD_MARKERS, SIMPLE_MAX_WORDS });
