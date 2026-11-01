/* AUTH V2.4 (owner 2026-10-31): the internal surface is gated, and stays gated.
 *
 * The blueprint's finding ১৮: "the DO's /internal/* trusts the caller; the
 * comment says token-gated, the code does not check". I checked before changing
 * anything, and the finding is half right — which is why it is worth writing
 * down rather than acting on:
 *
 *   • The Durable Object itself verifies NO caller identity. Every /internal/*
 *     route runs for whoever reaches it. That part of the finding is true.
 *   • The gate is one layer out, in the public handler, and it is real: all nine
 *     admin routes call `adminAuthorized` (a constant-time comparison against
 *     ADMIN_TOKEN) before forwarding. The comment on the DO route says exactly
 *     this — "token-gated in the public handler" — so the code and the comment
 *     agree.
 *   • And the DO is not externally addressable: a request to /internal/* from
 *     outside answers 404 on the Pages host and 403 on the worker host. The only
 *     caller is our own handler, through a service binding.
 *
 * So this is defence-in-depth, not an open hole. The risk is not that it is
 * broken today; it is that nothing pins it, so a refactor could move a route out
 * from behind the gate and no test would notice. That is what this file holds.
 *
 * It does NOT add caller verification inside the DO. That would be a real change
 * to the live auth path for a threat the platform already blocks, and the honest
 * place to record a verified non-issue is a test, not a risky edit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HANDLER = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');
const AUTHORITY = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');

/* Every admin route the public handler answers. If one is added, it must be
 * gated — so this list is asserted against the code rather than trusted. */
const ADMIN_ROUTES = Object.freeze([
  '/admin/account/state',
  '/admin/identity/health',
  '/admin/security/events',
  '/admin/security/health',
  '/admin/students',
  '/admin/students/profile',
  '/admin/students/wipe',
  '/admin/verification/config',
  '/admin/verification/status'
]);

test('V2.4-১৮: every admin route checks the token before it forwards', () => {
  /* The property that makes the DO's trust acceptable: nothing reaches it
   * without passing this. Asserted by walking each route's block and requiring
   * the gate to appear BEFORE the forward, not merely somewhere nearby. */
  for (const route of ADMIN_ROUTES) {
    const at = HANDLER.indexOf(`\${AUTH_API_PREFIX}${route}\``);
    assert.ok(at > 0, `${route} exists`);
    const block = HANDLER.slice(at, at + 1200);
    const gate = block.indexOf('adminAuthorized(request, env)');
    assert.ok(gate > 0, `${route} must check the admin token`);
    const forward = block.indexOf('callAuthority(');
    if (forward > 0) assert.ok(gate < forward, `${route}: the gate must run before the forward`);
  }
});

test('V2.4-১৮: no admin route is answered without the gate', () => {
  /* The count is pinned so a new admin route cannot be added ungated. This is
   * the regression the finding is really about: not today's code, but tomorrow's. */
  const gated = (HANDLER.match(/adminAuthorized\(request, env\)/g) || []).length;
  assert.equal(gated, ADMIN_ROUTES.length, 'one gate per admin route, no more and no fewer');
  // And there is no admin route in the handler that the list above does not name.
  const declared = [...HANDLER.matchAll(/AUTH_API_PREFIX\}(\/admin\/[a-z/-]+)`/g)].map(match => match[1]);
  assert.deepEqual([...new Set(declared)].sort(), [...ADMIN_ROUTES].sort(),
    'an admin route was added or removed — update this list, and gate it');
});

test('V2.4-১৮: the token comparison is constant-time and refuses an unset token', () => {
  /* Two ways a gate becomes decorative: a `===` comparison (timing) and an empty
   * expected token, which would make every caller "authorized". */
  const gate = HANDLER.slice(HANDLER.indexOf('const adminAuthorized ='), HANDLER.indexOf('const passkeyEndpointReady'));
  assert.match(gate, /constantTimeEqual\(supplied, expected\)/, 'the comparison must be constant-time');
  assert.match(gate, /expected\.length >= 20/, 'an unset or short ADMIN_TOKEN must refuse everyone');
  assert.doesNotMatch(gate, /supplied === expected/, 'a plain comparison would leak the token by timing');
});

test('V2.4-১৮: the DO verifies no caller, which is the finding — recorded, not hidden', () => {
  /* The half of the finding that IS true, pinned so a reader does not have to
   * re-derive it. If a later change adds caller verification inside the DO, this
   * fails and the reader learns the architecture changed deliberately. */
  assert.equal((AUTHORITY.match(/X-AH-Admin-Token|adminAuthorized/g) || []).length, 0,
    'the DO trusts its caller by design; the gate is in the handler one layer out');
  // And the DO's comment says so rather than claiming a gate it does not have.
  assert.match(AUTHORITY, /token-gated in the public\s*\n?\s*\/\/ handler|token-gated in the public handler|token-gated in the public/,
    'the comment must name where the gate actually lives');
});

test('V2.4-১৮: the internal prefix is not a public surface', () => {
  /* The reason the DO's trust is acceptable at all. If a route ever exposed
   * /internal/* directly, every one of those 98 forwards would become reachable
   * by an untrusted caller — so this pins that the handler claims only the auth
   * and public-profile prefixes. */
  const claims = HANDLER.slice(HANDLER.indexOf('export function claimsAuthPath'), HANDLER.indexOf('export const AUTH_SESSION_COOKIE'));
  assert.doesNotMatch(claims, /internal/, 'the handler must not claim /internal/* as a public path');
  assert.match(claims, /AUTH_API_PREFIX/, 'it claims the auth prefix');
  assert.match(claims, /PUBLIC_PROFILE_PREFIX/, 'and the public profile projection');
});
