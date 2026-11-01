/* F1.7 — Agent Loop: a failed tool is a result, not silence.
 *
 * `renderToolContext` skipped every failed tool except web_search. So a
 * `get_exam_history` that timed out, or that ran out of the tool time budget,
 * was dropped on the floor — and the model then saw exactly what it sees when no
 * tool was planned at all.
 *
 * Told nothing, a model does the reasonable thing with what it has and says
 * "তোমার কোনো তথ্য নেই": a confident claim about the student's OWN data that is
 * simply wrong, and the student cannot tell it apart from the truth.
 *
 * These tests hold the property: every failed tool reaches the model as a
 * failure, with a reason and an instruction not to deny the data exists, while a
 * successful tool's context is unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToolContext, renderToolFailure } from '../../sky-tools.mjs';

test('a timed-out tool is not silently dropped', () => {
  /* The regression this file exists for: this used to render to ''. */
  const ctx = renderToolContext([{ name: 'get_exam_history', ok: false, error: 'timeout' }]);
  assert.notEqual(ctx, '', 'silence is what made the model deny the data exists');
  assert.match(ctx, /get_exam_history/);
  assert.match(ctx, /FAILED/);
});

test('the model is told not to deny the information exists', () => {
  /* The whole point: "I could not read it now" is true; "you have nothing" is
     not. The rendered instruction must steer to the former. */
  const ctx = renderToolFailure({ name: 'analyze_weak_topics', ok: false, error: 'budget' });
  assert.match(ctx, /do NOT say there is no such information/);
});

test('every failure reason is named, not collapsed to one word', () => {
  const reasons = ['timeout', 'budget', 'failed', 'unknown-tool', 'owner-from-args-rejected'];
  const seen = reasons.map((e) => renderToolFailure({ name: 'get_datetime', ok: false, error: e }));
  assert.equal(new Set(seen).size, reasons.length, 'a budget fault must read differently from a timeout');
  for (const s of seen) assert.match(s, /No data was returned/);
});

test('a successful tool context is unchanged', () => {
  /* This change must only touch the failure path. */
  const ok = renderToolContext([{ name: 'calculate', ok: true, expression: '২৫×৪', value: '100' }]);
  assert.match(ok, /exact; use this number/);
  assert.ok(!/FAILED/.test(ok), 'a success must not be labelled a failure');
});

test('web_search keeps its own, more specific failure wording', () => {
  /* web_search already had a dedicated failure renderer; it must not be
     replaced by the generic one. */
  const ctx = renderToolContext([{ name: 'web_search', ok: false, error: 'daily-limit' }]);
  assert.match(ctx, /could not run/);
  assert.ok(!/FAILED/.test(ctx), 'web_search keeps its specific message');
});

test('a mixed batch reports the success and the failure', () => {
  const ctx = renderToolContext([
    { name: 'calculate', ok: true, expression: '২+২', value: '4' },
    { name: 'get_exam_history', ok: false, error: 'timeout' }
  ]);
  assert.match(ctx, /calculate/);
  assert.match(ctx, /get_exam_history FAILED/);
});
