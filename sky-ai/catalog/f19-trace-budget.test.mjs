/* F1.9 — Trace v2 + budget guard: the trace judges, it does not just count.
 *
 * The trace already counted tokensIn/tokensOut, so the numbers needed to catch
 * an over-budget request were there and nothing compared them to a limit. A
 * request that blew past the context window was recorded, after the fact, as if
 * it were normal — the one place that should have warned said nothing.
 *
 * These tests hold the property: the same numbers now yield a verdict, the
 * verdict reaches the trace, a missing limit means "not configured" rather than
 * "zero allowed", and the trace still carries no message text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetGuard, BUDGET, makeTrace, TRACE_FIELDS, sanitizeTrace, validateObservability
} from '../../observability.js';

test('an over-context request is caught, not logged as normal', () => {
  /* The regression this file exists for. */
  const g = budgetGuard({ tokensIn: 900, tokensOut: 10, maxContext: 800, maxOutput: 500 });
  assert.equal(g.state, BUDGET.CONTEXT);
});

test('an over-output request is caught too', () => {
  const g = budgetGuard({ tokensIn: 10, tokensOut: 900, maxContext: 800, maxOutput: 500 });
  assert.equal(g.state, BUDGET.OUTPUT);
});

test('a request inside both limits is OK', () => {
  const g = budgetGuard({ tokensIn: 100, tokensOut: 100, maxContext: 800, maxOutput: 500 });
  assert.equal(g.state, BUDGET.OK);
});

test('an unset limit means "not configured", not "zero allowed"', () => {
  /* A limit of 0 would mark every request over budget and make the guard noise,
     so a missing or zero limit must read as no limit at all. */
  assert.equal(budgetGuard({ tokensIn: 999999, tokensOut: 999999 }).state, BUDGET.OK);
  assert.equal(budgetGuard({ tokensIn: 999999, tokensOut: 999999, maxContext: 0, maxOutput: 0 }).state, BUDGET.OK);
});

test('the verdict reaches the trace, not just the helper', () => {
  /* A guard whose answer never leaves the function guards nothing. */
  const tr = makeTrace({ rid: 'r-1', tokensIn: 900, tokensOut: 10, budgetState: BUDGET.CONTEXT });
  assert.equal(tr.budgetState, BUDGET.CONTEXT);
  assert.equal(sanitizeTrace({ rid: 'r-1', budgetState: BUDGET.OUTPUT }).budgetState, BUDGET.OUTPUT);
});

test('the trace still leaks no message text', () => {
  /* The whole point of the whitelist: adding a field must not widen it into
     content. budgetState is a verdict word, never a message. */
  assert.ok(TRACE_FIELDS.includes('budgetState'), 'the new field is whitelisted');
  assert.ok(!TRACE_FIELDS.includes('text') && !TRACE_FIELDS.includes('content'));
  const tr = makeTrace({ rid: 'r-1', text: 'a student secret', budgetState: BUDGET.OK });
  assert.ok(!('text' in tr), 'message text must never enter a trace');
});

test('observability self-check knows about the budget verdict', () => {
  assert.deepEqual(validateObservability(), []);
  assert.equal(Object.values(BUDGET).length, 3);
});
