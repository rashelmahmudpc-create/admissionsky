import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTH_ROUTE_LOCAL_PATHS, AUTH_ROUTE_MODES, authRouteMode, routeAuthRequest } from './auth-native/worker/auth-route.mjs';
import { claimsAuthPath } from './auth-native/worker/public-auth-handler.mjs';

// F-04 phase 2. The switch that sends logins to another Worker is only safe if
// every way of getting it wrong still ends at the handler that works today.
const WRANGLER = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
const ENTRY = readFileSync(new URL('./gk-agent-worker.js', import.meta.url), 'utf8');

const request = (path, init = {}) => new Request(`https://admissionsky.pages.dev${path}`, init);

const harness = ({ env, path = '/api/auth/v1/session', init = {}, response = new Response('remote', { status: 200 }), forwardImpl = null } = {}) => {
  const calls = { local: 0, forward: 0 };
  const local = async () => { calls.local += 1; return new Response('local', { status: 200 }); };
  const forward = async () => { calls.forward += 1; return forwardImpl ? forwardImpl() : response; };
  return {
    calls,
    run: () => routeAuthRequest({ request: request(path, init), env, ctx: {}, local, forward })
  };
};

test('the mode is an explicit switch, and the in-process answer is always the way back', () => {
  const committed = WRANGLER.match(/^AUTH_ROUTE = "([a-z]+)"$/m);
  assert.ok(committed, 'AUTH_ROUTE is committed explicitly, never left implicit');
  assert.ok(['local', 'service'].includes(committed[1]), `unexpected mode: ${committed[1]}`);
  // Whatever the deployed mode, a missing or broken binding must degrade to the
  // handler that has always served these routes — that is the whole rollback.
  assert.match(WRANGLER, /binding = "AUTH_WORKER"\nservice = "admission-auth"/);
  assert.equal(authRouteMode({}), AUTH_ROUTE_MODES.local);
  assert.equal(authRouteMode({ AUTH_ROUTE: 'service' }), AUTH_ROUTE_MODES.local, 'a mode with no binding is a mistake, not an instruction');
  assert.equal(authRouteMode({ AUTH_ROUTE: 'SERVICE ', AUTH_WORKER: { fetch() {} } }), AUTH_ROUTE_MODES.service);
});

test('a local route never touches the auth Worker', async () => {
  const app = harness({ env: { AUTH_ROUTE: 'local', AUTH_WORKER: { fetch: async () => new Response('x') } } });
  const response = await app.run();
  assert.equal(await response.text(), 'local');
  assert.deepEqual(app.calls, { local: 1, forward: 0 });
});

test('service mode forwards only the paths the auth handler owns', async () => {
  const binding = { fetch: async () => new Response('remote', { status: 200 }) };
  const authPath = harness({ env: { AUTH_ROUTE: 'service', AUTH_WORKER: binding } });
  assert.equal(await (await authPath.run()).text(), 'remote');
  assert.deepEqual(authPath.calls, { local: 0, forward: 1 });

  for (const path of ['/api/ask', '/index.html', '/api/files/x']) {
    const other = harness({ env: { AUTH_ROUTE: 'service', AUTH_WORKER: binding }, path });
    assert.equal(await (await other.run()).text(), 'local', `${path} keeps falling through the app chain`);
    assert.deepEqual(other.calls, { local: 1, forward: 0 }, `${path} must not reach the auth Worker`);
  }
});

test('the one route whose secret still lives only in admission-gk stays in process', async () => {
  const binding = { fetch: async () => new Response('remote', { status: 200 }) };
  for (const path of AUTH_ROUTE_LOCAL_PATHS) {
    assert.ok(claimsAuthPath(path), `${path} is an auth path, so the exception has to be explicit`);
    const app = harness({ env: { AUTH_ROUTE: 'service', AUTH_WORKER: binding }, path });
    assert.equal(await (await app.run()).text(), 'local');
    assert.deepEqual(app.calls, { local: 1, forward: 0 }, `${path} must not be forwarded before its secret exists here`);
  }
  // The exception is a staging detail, not a hole in the surface: the routes
  // students actually use are still forwarded.
  for (const path of ['/api/auth/v1/signup', '/api/auth/v1/login', '/api/auth/v1/session']) {
    const app = harness({ env: { AUTH_ROUTE: 'service', AUTH_WORKER: binding }, path });
    assert.equal(await (await app.run()).text(), 'remote', `${path} is forwarded`);
  }
});

test('a transport failure falls back to the in-process handler instead of failing the login', async () => {
  const app = harness({
    env: { AUTH_ROUTE: 'service', AUTH_WORKER: { fetch: async () => { throw new Error('binding down'); } } },
    forwardImpl: async () => { throw new Error('binding down'); }
  });
  const response = await app.run();
  assert.equal(await response.text(), 'local', 'the old path answers');
  assert.deepEqual(app.calls, { local: 1, forward: 1 });
});

test('a POST keeps its body for the fallback', async () => {
  let seen = '';
  const local = async request => { seen = await request.text(); return new Response('local', { status: 200 }); };
  await routeAuthRequest({
    request: request('/api/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: 'a@b.c' }) }),
    env: { AUTH_ROUTE: 'service', AUTH_WORKER: { fetch: async () => { throw new Error('down'); } } },
    ctx: {},
    local
  });
  assert.equal(seen, JSON.stringify({ email: 'a@b.c' }), 'the body survived the failed forward');
});

test('the app still routes auth through the switch, and owns the predicate', () => {
  assert.match(ENTRY, /routeAuthRequest\(\{/);
  assert.match(ENTRY, /import \{ routeAuthRequest \} from '\.\/auth-native\/worker\/auth-route\.mjs'/);
  // One predicate, used by both the handler and the router — a drifting copy is
  // how the public profile route silently 404'd once already.
  assert.equal(claimsAuthPath('/api/auth/v1/config'), true);
  assert.equal(claimsAuthPath('/api/public/profile/AH-0O1ILX'), true);
  assert.equal(claimsAuthPath('/api/ask'), false);
  assert.match(WRANGLER, /\[\[services\]\]\nbinding = "AUTH_WORKER"\nservice = "admission-auth"/);
});
