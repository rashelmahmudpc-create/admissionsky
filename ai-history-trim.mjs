/**
 * P27, bounded history selection (step 3 of the owner's AI cost plan).
 *
 * THE PROBLEM
 * -----------
 * Long threads were sent to the model almost verbatim. The old rule kept the
 * last 12 turns raw and only summarised anything once the thread passed 16
 * turns, so the 9–16 turn range, an ordinary tutoring session, shipped every
 * earlier answer in full. With assistant turns allowed to reach 4000 characters,
 * that is thousands of characters of history re-sent on every follow-up. Every
 * provider here is on a free tier, so the cost is quota burned on context the
 * model does not need in order to answer the current question.
 *
 * THE RULE
 * --------
 * Keep the most recent turns verbatim, a follow-up genuinely depends on those -
 * and replace everything older with a one-line-per-turn digest. The digest keeps
 * the *shape* of the conversation (who said what, which topics) without the full
 * text, so continuity survives while the prompt shrinks.
 *
 * This module only decides which turns to send. Persisting the digest across
 * sessions stays the caller's decision, so the durable rolling summary keeps its
 * existing behaviour.
 */

export const HISTORY = Object.freeze({
  /* Turns kept word-for-word. Eight is enough for "explain that again" style
   * follow-ups while still halving a typical 16-turn thread. */
  RECENT: 8,
  /* Layout matches the existing rolling summary, which tests and the prompt
   * renderer already expect. */
  DIGEST_HEADER: 'পূর্বের কথোপকথন (সংক্ষেপ):\n',
  DIGEST_PER_TURN_CHARS: 90,
  DIGEST_MAX_CHARS: 900
});

/** One line per turn, same shape as `summarizeTo` so the prompt reads identically. */
export function digestTurns(messages, maxChars = HISTORY.DIGEST_MAX_CHARS) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (!msgs.length) return '';
  let out = HISTORY.DIGEST_HEADER;
  for (const m of msgs) {
    const who = m && m.role === 'user' ? 'শিক্ষার্থী' : 'AI';
    const txt = String((m && m.content) || '').replace(/\s+/g, ' ').trim().slice(0, HISTORY.DIGEST_PER_TURN_CHARS);
    if (!txt) continue;
    out += `- ${who}: ${txt}\n`;
  }
  return out.length > maxChars ? out.slice(0, maxChars) + '…' : out;
}

/**
 * Split a thread into "kept verbatim" and "digested".
 *
 * `recent` is the number of trailing turns kept raw. When the thread is no
 * longer than that, nothing is touched, short threads are byte-identical to
 * before, so this cannot change a quick exchange.
 */
export function selectHistory(messages, opts = {}) {
  const msgs = Array.isArray(messages) ? messages : [];
  const recent = Number.isInteger(opts.recent) && opts.recent > 0 ? opts.recent : HISTORY.RECENT;
  if (msgs.length <= recent) {
    return { kept: msgs.slice(), digest: '', compacted: 0, droppedChars: 0 };
  }
  const cut = msgs.length - recent;
  const older = msgs.slice(0, cut);
  const kept = msgs.slice(cut);
  const before = older.reduce((n, m) => n + String((m && m.content) || '').length, 0);
  const digest = digestTurns(older, opts.maxDigestChars);
  return {
    kept,
    digest,
    compacted: older.length,
    droppedChars: Math.max(0, before - digest.length)
  };
}

/**
 * Cap the stored-memory turns prepended to a new session.
 *
 * The recall is written bounded, but a record written by an older version (or a
 * partially-written value) can be longer on read, and it is prepended *before*
 * the current thread, so an unbounded value here inflates every request in the
 * session. Keeping the newest few preserves continuity; the rest is dropped
 * rather than re-sent.
 */
export function capRecalledTurns(mem, max = 4) {
  const list = Array.isArray(mem) ? mem.filter(Boolean) : [];
  return list.length <= max ? list.slice() : list.slice(list.length - max);
}
