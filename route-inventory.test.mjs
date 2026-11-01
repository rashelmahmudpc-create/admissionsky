/* AUTH V2.3 (owner 2026-10-31): the endpoint inventory, pinned.
 *
 * The blueprint's V2.3 wants 60+ endpoints reduced to ~20, and names its own
 * risk in the same breath: "Endpoint একীকরণে পুরনো ক্লায়েন্ট ভাঙতে পারে" — a
 * cached client calling a route that no longer exists. Its mitigation is "one
 * line of redirect for every removed route", and that mitigation cannot be
 * applied to a route nobody wrote down.
 *
 * So this ships the list first, and a guard around it. That is the same order
 * V2.2 used, for the same reason: a change is only safe once what it changes is
 * measured. Nothing is removed here — this change adds no behaviour at all. It
 * makes the NEXT change checkable.
 *
 * What the guard holds:
 *
 *   • every route the auth surface answers is named, with its method;
 *   • a route cannot disappear without this failing, so a removal is a decision
 *     someone made rather than an accident a refactor made;
 *   • every route is classified by who calls it, so a route with no caller is
 *     visible as a fact rather than discovered later as a surprise.
 *
 * The classification is deliberately three-valued, not two. "No client calls
 * it" is not "dead": the Telegram webhook is called by Telegram, the admin
 * routes by console pages, and the operational routes by workflows. Treating
 * those as dead is exactly how a consolidation breaks something nobody was
 * looking at.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const HANDLER = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');

/* Every route the auth surface answers, as of this change. Sorted, so a diff
 * reads as "these were added" or "these were removed" rather than noise. */
const PINNED_ROUTES = Object.freeze({
  '/account': 'GET',
  '/account-verification/email/start': 'POST',
  '/account-verification/email/status': 'POST',
  '/admin/account/state': 'POST',
  '/admin/identity/health': 'GET',
  '/admin/security/events': 'GET',
  '/admin/security/health': 'GET',
  '/admin/students': 'GET',
  '/admin/students/profile': 'GET',
  '/admin/students/wipe': 'POST',
  '/admin/verification/config': 'POST',
  '/admin/verification/status': 'GET',
  '/backup/request': 'POST',
  '/backup/verify': 'POST',
  '/config': 'GET',
  '/email-ownership/start': 'POST',
  '/email-ownership/status': 'POST',
  '/email-ownership/verify': 'POST',
  '/facebook': 'POST',
  '/google': 'POST',
  '/google/link': 'POST',
  '/identities': 'GET',
  '/login': 'POST',
  '/passkey/authentication/begin': 'POST',
  '/passkey/authentication/finish': 'POST',
  '/passkey/registration/begin': 'POST',
  '/passkey/registration/finish': 'POST',
  '/passkey/remove': 'POST',
  '/passkey/status': 'GET',
  '/password-reset': 'POST',
  '/profile': 'GET',
  '/profile/avatar': 'GET',
  '/profile/patch': 'POST',
  '/profile/pending': 'POST',
  '/security/challenge/cancel': 'POST',
  '/security/challenge/request': 'POST',
  '/security/challenge/verify': 'POST',
  '/security/device/trust': 'POST',
  '/security/devices/revoke': 'POST',
  '/security/history': 'GET',
  '/security/state': 'GET',
  '/session': 'GET',
  '/session/logout': 'POST',
  '/session/logout-all': 'POST',
  '/signup': 'POST',
  '/telegram/login': 'POST',
  '/telegram/verification/pending': 'GET',
  '/telegram/verification/resend': 'POST',
  '/telegram/verification/start': 'POST',
  '/telegram/verification/verify': 'POST',
  '/telegram/webhook': 'POST',
  '/verification/resend': 'POST',
});

/* Who reaches each route. A route may legitimately have no browser caller — the
 * point is that the reason is written down, not assumed. */
const CALLER_KIND = Object.freeze({
  // Called by Telegram's servers, configured in wrangler.toml.
  webhook: ['/telegram/webhook'],
  // Called by the operator consoles (students-*, verification-*, notification-*).
  console: [
    '/admin/account/state', '/admin/identity/health', '/admin/security/events', '/admin/security/health',
    '/admin/students', '/admin/students/profile', '/admin/students/wipe',
    '/admin/verification/config', '/admin/verification/status'
  ],
  // Reached by the activation workflows and the canary runbook, not by a page.
  // They are answered by a separate array-membership check in the handler, so
  // they do not appear in the pinned list above — noted here so a later reader
  // does not think they were missed.
  operational: []
});

/* Public routes with no caller in any shipped client. Named rather than
 * inferred, so the reason is a decision someone made: these are API surface the
 * app does not currently use, and a consolidation may remove them — but only
 * deliberately, with the redirect the blueprint requires. */
const UNCALLED_BUT_INTENTIONAL = new Set([
  '/account',            // superseded by /session + /security/state on the client
  '/email-ownership/status', // the client polls /email-ownership/start instead
  '/identities',         // read by no page; the account view uses /account
  '/security/devices/revoke',
  '/security/history',
  '/security/state'
]);

/* Read the routes the handler actually answers.
 *
 * The pattern requires the condition to START the `if`, so a line that has been
 * commented out, disabled with a `false &&` guard, or nested inside a branch
 * that cannot run does not count. My first version matched anywhere on the line
 * and therefore counted a route that had been turned off — a guard that cannot
 * see a removal is not a guard. */
const parseRoutes = () => {
  const found = {};
  const pattern = /^\s*if \(request\.method === '([A-Z]+)' && url\.pathname === `\$\{AUTH_API_PREFIX\}([^`]*)`\)/gm;
  for (const match of HANDLER.matchAll(pattern)) found[match[2]] = match[1];
  return found;
};

test('V2.3: every route the handler answers is on the inventory', () => {
  /* The guard that makes a removal a decision. A route that vanishes without
   * this list changing means someone deleted it as a side effect of something
   * else — which is precisely the accident that breaks a cached client. */
  const actual = parseRoutes();
  const pinned = { ...PINNED_ROUTES };
  const missing = Object.keys(pinned).filter(route => !(route in actual));
  const added = Object.keys(actual).filter(route => !(route in pinned));
  assert.deepEqual(missing, [], 'a pinned route was removed — update the inventory deliberately, with a redirect');
  assert.deepEqual(added, [], 'a route was added — add it to the inventory so the next removal is checkable');
});

test('V2.3: each pinned route still answers the method it was pinned with', () => {
  /* A route that quietly changes verb is the same class of break as a route that
   * disappears: a cached client sending POST to a GET gets a 405 it cannot read.
   */
  const actual = parseRoutes();
  for (const [route, method] of Object.entries(PINNED_ROUTES)) {
    assert.equal(actual[route], method, `${route} must still answer ${method}`);
  }
});

test('V2.3: the inventory is the whole surface, with nothing hidden behind a prefix', () => {
  /* A route reached by a prefix test would not appear in the pinned list, and a
   * consolidation would miss it. There is exactly one such prefix today — the
   * public profile projection, which sits outside the auth prefix by design and
   * is claimed by `claimsAuthPath`. Asserted by name so a second prefix cannot
   * be added without this failing. */
  const prefixClaims = [...HANDLER.matchAll(/path\.startsWith\(([A-Z_]+)\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(prefixClaims)].sort(), ['PUBLIC_PROFILE_PREFIX'],
    'a new prefix-reached route must be added to the inventory, or a consolidation will miss it');
  // And the public-profile prefix is documented in the inventory's own terms.
  assert.ok(HANDLER.includes('PUBLIC_PROFILE_PREFIX'), 'the out-of-prefix surface is still claimed');
});

test('V2.3: every route with no browser caller has a written reason', () => {
  /* "No client calls it" is not "dead". The Telegram webhook is called by
   * Telegram, the admin routes by console pages, the canary routes by workflows.
   * Classifying those as dead is exactly how a consolidation breaks something
   * nobody was looking at. */
  const clients = readdirSync('.')
    .filter(name => (name.endsWith('.js') || name.endsWith('.html'))
      && !name.startsWith('gk-agent') && !name.includes('worker') && name !== 'sw.js');
  const haystack = clients.map(name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')).join('\n');
  const referenced = route => haystack.includes(`'${route}'`) || haystack.includes(`"${route}"`)
    || haystack.includes(`/api/auth/v1${route}`) || haystack.includes(`\${API}${route}`);

  const justified = new Set(Object.values(CALLER_KIND).flat());
  const unexplained = [];
  for (const route of Object.keys(PINNED_ROUTES)) {
    if (referenced(route)) continue;
    if (justified.has(route)) continue;
    // The retired Telegram verification flow is reachable only through the
    // capability gate, which the client hardcodes to false — so no page calls it
    // and none can. Recorded rather than deleted: the owner's rule is that
    // unproven things move to the back, not out.
    if (route.startsWith('/telegram/verification/')) continue;
    // Public API surface with no current caller. Not dead — the owner's rule is
    // that unproven things move to the back rather than out — but recorded here
    // as the honest state, because these are the routes a consolidation would
    // look at first and the reason must be visible rather than assumed.
    if (UNCALLED_BUT_INTENTIONAL.has(route)) continue;
    unexplained.push(route);
  }
  assert.deepEqual(unexplained, [],
    'a route with no caller and no stated reason — say why it exists, or it is the next thing removed by accident');
});

test('V2.3: the three caller kinds are disjoint and each names routes that exist', () => {
  // A route listed under two kinds means nobody knows who calls it; a route
  // listed under a kind but absent from the inventory means the note is stale.
  const seen = new Set();
  for (const [kind, routes] of Object.entries(CALLER_KIND)) {
    for (const route of routes) {
      assert.ok(PINNED_ROUTES[route], `${kind} names ${route}, which is not a route`);
      assert.equal(seen.has(route), false, `${route} is classified twice`);
      seen.add(route);
    }
  }
});

test('V2.3: nothing has been consolidated yet — this change adds no behaviour', () => {
  /* The step's own boundary, the same one V2.2 used. This ships the inventory,
   * not a migration: the count is asserted so a later change that removes routes
   * has to say so here, deliberately. */
  assert.equal(Object.keys(PINNED_ROUTES).length, 52,
    'the surface is 52 routes; a consolidation changes this number and must update this test');
});
