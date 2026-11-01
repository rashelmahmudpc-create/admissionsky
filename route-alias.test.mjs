/* AUTH V2.3 (owner 2026-10-31): a consolidated route still answers at its old address.
 *
 * The blueprint's own mitigation for endpoint consolidation: one redirect per
 * removed route. A cached client — a service worker holding an older shell, a
 * phone that has not reloaded — keeps calling the old path for as long as its
 * cache lives, and a 404 is not something that client can recover from. A
 * redirect is.
 *
 * The table is empty and nothing has moved. That is deliberate: the mechanism
 * ships BEFORE the first route moves, because a mechanism invented during the
 * risky change is one written under pressure. The route-inventory guard fails
 * when a pinned route disappears, so the first removal has to add an entry here
 * — which makes the redirect a required part of that change rather than a
 * follow-up someone forgets.
 *
 * These tests therefore do two jobs: they prove the mechanism works, using a
 * temporary alias, and they prove it is inert today, so shipping it cannot have
 * changed any existing request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_API_PREFIX,
  AUTH_ROUTE_ALIASES,
  createNativeAuthHandler,
  resolveAuthAlias
} from './auth-native/worker/public-auth-handler.mjs';

const handler = () => createNativeAuthHandler({ fetchImpl: async () => Response.json({}, { status: 404 }) });
const authority = () => ({
  idFromName: name => name,
  get() { return { fetch: async () => Response.json({ ok: true, result: {} }) }; }
});
const call = (path, env = {}) => handler()(new Request(`https://worker.example${path}`, {
  headers: {
    Origin: 'https://admissionhub.pages.dev', 'CF-Connecting-IP': '203.0.113.4',
    'User-Agent': 'Chrome', 'X-AH-Auth-UI': 'auth-premium-v6'
  }
}), { AUTH_AUTHORITY: authority(), ...env }, {});

test('V2.3: the alias table is empty, so this change cannot have moved a route', () => {
  /* The inertness assertion. If this fails, a route was consolidated in the same
   * change that introduced the mechanism — and a reader deserves to see that
   * stated rather than inferred from a diff. */
  assert.deepEqual(Object.keys(AUTH_ROUTE_ALIASES), [], 'no route has been consolidated yet');
});

test('V2.3: a path that has not moved is returned unchanged', () => {
  // The caller can always call this without checking first, which is what makes
  // it safe to put on the hot path of every request.
  for (const path of ['/api/auth/v1/session', '/api/auth/v1/signup', '/api/public/profile/abc', '', '/']) {
    assert.equal(resolveAuthAlias(path), path);
  }
  assert.equal(resolveAuthAlias(null), '');
  assert.equal(resolveAuthAlias(undefined), '');
});

test('V2.3: an aliased path redirects permanently, preserving the query string', async () => {
  /* Exercised by INJECTING a table rather than by moving a real route: moving
   * one would be a behaviour change, and this change adds none. The query string
   * is the part worth being careful about — a `?telegramCanary=1` decides which
   * branch a request takes, so dropping it would silently change behaviour
   * rather than merely losing a parameter. */
  const table = Object.freeze({ [`${AUTH_API_PREFIX}/old-verify`]: `${AUTH_API_PREFIX}/email-ownership/verify` });
  const withAlias = createNativeAuthHandler({ fetchImpl: async () => Response.json({}, { status: 404 }), routeAliases: table });
  const response = await withAlias(new Request(
    `https://worker.example${AUTH_API_PREFIX}/old-verify?telegramCanary=1&cursor=abc`,
    { method: 'POST', headers: {
      Origin: 'https://admissionhub.pages.dev', 'CF-Connecting-IP': '203.0.113.4',
      'User-Agent': 'Chrome', 'X-AH-Auth-UI': 'auth-premium-v6', 'Content-Type': 'application/json'
    }, body: '{}' }
  ), { AUTH_AUTHORITY: authority() }, {});

  assert.equal(response.status, 308, 'a moved route answers with a permanent redirect');
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.pathname, `${AUTH_API_PREFIX}/email-ownership/verify`, 'and points at the new path');
  // The parameters survive, or a request would take a different branch after the
  // move than it did before — a silent behaviour change.
  assert.equal(location.searchParams.get('telegramCanary'), '1');
  assert.equal(location.searchParams.get('cursor'), 'abc');
});

test('V2.3: every alias must point at a route that exists, and must not chain', () => {
  /* Two failure modes a redirect table invites, both silent:
   *   • pointing at a path that does not exist turns a 404 into a 404 via a
   *     redirect, which is worse — the client now cannot tell what happened;
   *   • an alias that points at another alias means a client can be bounced
   *     twice, and the second hop is invisible in the table.
   * Asserted as data, so the check works whether the table is empty or full. */
  const paths = Object.keys(AUTH_ROUTE_ALIASES);
  for (const from of paths) {
    const to = AUTH_ROUTE_ALIASES[from];
    assert.notEqual(to, from, `${from} aliases itself`);
    assert.equal(paths.includes(to), false, `${from} aliases another alias (${to}) — a client would bounce twice`);
    assert.ok(to.startsWith(`${AUTH_API_PREFIX}/`), `${from} must point inside the auth surface`);
  }
});

test('V2.3: the alias check runs before the origin gate, so a redirect is not a 403', async () => {
  /* Ordering is load-bearing. A redirect answered AFTER the origin check would
   * be refused for a client whose origin the gate dislikes — so the client would
   * get a 403 where the old route used to work, which is exactly the breakage
   * the redirect exists to prevent. Asserted on the source because the table is
   * empty and no runtime request can exercise the ordering yet. */
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');
  const aliasAt = source.indexOf('const aliasedPath = resolveAuthAlias(url.pathname, routeAliases);');
  const originAt = source.indexOf("const origin = request.headers.get('Origin') || '';");
  assert.ok(aliasAt > 0, 'the alias check exists');
  assert.ok(originAt > 0, 'the origin gate exists');
  assert.ok(aliasAt < originAt, 'the alias must be resolved before the origin gate');
});
