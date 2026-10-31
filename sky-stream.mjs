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
