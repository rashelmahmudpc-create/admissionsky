// F-04 phase 1: the admission-auth Worker.
//
// This script is the auth surface on its own. It answers exactly the routes
// `createNativeAuthHandler` claims and nothing else — any other path is a 404,
// so it can never turn into a second copy of the app by accident.
//
// It deliberately owns no data. AUTH_AUTHORITY is bound cross-script to
// `admission-gk` (wrangler.auth.toml), so the Durable Object keeps its storage,
// its sessions and its pending OTPs exactly where they are: a Durable Object id
// is scoped to the script that declares the class, so redeclaring the class here
// would have handed every student a blank authority.
//
// Phase 1 has no traffic: nothing routes to this Worker yet. Phase 2 flips
// `AUTH_ROUTE` on admission-gk to `service` once this script is verified.
import { createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const nativeAuthHandler = createNativeAuthHandler();

export default {
  async fetch(request, env, ctx) {
    const response = await nativeAuthHandler(request, env, ctx);
    // F-04: say who answered. admission-gk forwards the auth surface here and
    // falls back in process on a transport error, so a deploy can only prove the
    // forwarding path if the answer carries this mark. Without it a smoke test
    // passes on the fallback and says nothing about the split.
    if (response) {
      const marked = new Response(response.body, response);
      marked.headers.set('X-AH-Auth-Front', 'admission-auth');
      // F-04: rate limits, the shadow guard and security scoring all key off the
      // caller's address, and this script now receives most requests through a
      // service binding rather than from the edge directly. Whether the client
      // address survives that hop cannot be read from the code, so it is
      // measured on every deploy. The header carries no address — only whether
      // one arrived — so it tells a deploy what it needs and a stranger nothing.
      marked.headers.set('X-AH-Client-Addr', request.headers.get('CF-Connecting-IP') ? 'present' : 'absent');
      return marked;
    }
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};
