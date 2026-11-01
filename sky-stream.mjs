/* F0.4 — `sky-stream-v1`: the AI event stream, versioned.
 *
 * Before this file the stream had no name. The client parsed `event:` / `data:`
 * lines and guessed, so a protocol change could only be detected by breaking
 * someone. Two concrete consequences:
 *
 *   1. A stream cut mid-answer was indistinguishable from a short answer. The
 *      reader loop hit `step.done` or a read error, stopped, and returned
 *      `{ ok: true, text: <partial> }`. The student saw a truncated reply with
 *      no sign anything was wrong.
 *   2. There was no way to tell which shape of stream a client was talking to,
 *      so a new event could not be added without risking the old parser.
 *
 * `sky-stream-v1` fixes both without breaking a single existing client, because
 * every addition here is ADDITIVE:
 *
 *   - a `stream` hello event announces the version. An old parser does not know
 *     the name, and the payload carries no `text` / `error` / `model`, so the
 *     old client ignores it entirely.
 *   - every event gains a `seq` number. Extra keys are invisible to the old
 *     parser; a v1 client uses them to notice a gap.
 *   - `done` carries `stream`, so a client can record which protocol produced
 *     an answer.
 *
 * The event NAMES are deliberately unchanged (`stage`, `replace`, `done`,
 * `error`, and the bare `data:` text event), so the old parser takes the same
 * branch it always did.
 */

export const SKY_STREAM_VERSION = 'sky-stream-v1';

/* F2 Done-condition: the stream is never silent for 3 seconds. The provider's
 * first token may take up to AGENT_FIRST_CHUNK_MS (5 s by default), and a retry
 * after a dead key adds more on top, so between `hello` and the first text the
 * connection can sit idle well past that budget. A comment frame on a timer
 * keeps it moving.
 *
 * A comment is the right frame for this because it carries no `data:` line, so
 * every client — the pre-v1 parser and a v1 one — ignores it. The keep-alive is
 * additive in exactly the sense the rest of this file is: it changes what the
 * transport does, never what the client understands.
 *
 * It is a comment rather than a `stage` event on purpose. A stage claims work
 * happened, and inventing one to fill a gap would be a lie the student reads.
 */
export const SKY_HEARTBEAT_MS = 2000;

/**
 * Write `: hb` every `ms` until the returned function is called.
 *
 * A non-positive or unparseable `ms` falls back to the default rather than being
 * used: `setInterval(fn, 0)` fires on a tight loop, so a caller passing 0 (or a
 * garbage env value) would turn a keep-alive into a flood. A throwing `push` is
 * swallowed — a heartbeat exists to protect the stream, so it must never be the
 * thing that breaks it.
 *
 * @param {(chunk: string) => void} push
 * @param {number} [ms]
 * @returns {() => void} stop
 */
export function startHeartbeat(push, ms = SKY_HEARTBEAT_MS) {
  const wanted = Number(ms);
  const every = wanted > 0 ? wanted : SKY_HEARTBEAT_MS;
  const timer = setInterval(() => { try { push(': hb\n\n'); } catch (_) {} }, every);
  return () => { try { clearInterval(timer); } catch (_) {} };
}

/** One SSE frame. `event` may be '' for the bare `data:` text event the client
 *  has always understood. */
export function skySse(event, payload) {
  const data = JSON.stringify(payload);
  return event ? `event: ${event}\ndata: ${data}\n\n` : `data: ${data}\n\n`;
}

/**
 * A v1 writer over `push`. Every frame carries `seq`, starting at 0 with the
 * hello, so a client can tell a complete stream from a cut one.
 *
 * The counter is passed in so the two halves of one answer — the early stage
 * events and the model's text — share a single sequence. They are written by
 * two different stream controllers, and a per-writer counter would restart at
 * zero mid-answer, which is exactly the gap a client must not see.
 *
 * @param {(chunk: string) => void} push
 * @param {{n: number}} [counter]
 */
export function skyStream(push, counter = { n: 0 }) {
  /* `counter` IS the sequence, not a copy of its starting value: the second
     writer must continue where the first stopped. Reading `counter.n` into a
     local and incrementing the local restarts at zero mid-answer. */
  const send = (event, payload) => push(skySse(event, Object.assign({ seq: counter.n++ }, payload)));

  return {
    version: SKY_STREAM_VERSION,
    /** Announce the protocol. First frame, always. */
    hello: () => send('stream', { v: SKY_STREAM_VERSION, ev: 'hello' }),
    stage: (id, label) => send('stage', { stage: id, label }),
    text: (text) => send('', { text }),
    replace: (text) => send('replace', { text }),
    /** Last frame of a successful stream; carries the version for the record. */
    done: (payload = {}) => send('done', Object.assign({ stream: SKY_STREAM_VERSION }, payload)),
    error: (payload = {}) => send('error', payload),
    /** Frames emitted so far — the next `seq`. */
    get count() { return counter.n; },
  };
}
