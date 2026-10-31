/* P30 — AI chat latency + shared academic cache (owner order 2026-10-16). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSharedAcademicCandidate, isCacheableRequest } from './ai-chat-cache.mjs';

const SRC = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
const base = (content, extra = {}) => ({
  messages: [{ role: 'user', content }], hasImage: false, quizMode: false, onboarding: null,
  examMode: '', intent: 'ACADEMIC_EXPLAIN', fresh: true, recalled: false, ...extra
});

test('a self-contained study question qualifies for the shared cache', () => {
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?')), true);
  assert.equal(isSharedAcademicCandidate(base('What is photosynthesis?')), true);
});

test('questions about the student or earlier messages never share', () => {
  for (const q of ['আমার দুর্বল টপিক কী?', 'এটা আরো বুঝাও', 'আগের প্রশ্নটা আবার বুঝাও', 'explain my mistakes', 'explain that again']) {
    assert.equal(isSharedAcademicCandidate(base(q)), false, q);
  }
});

test('non-academic, multi-turn, image, quiz, onboarding and mock exam never share', () => {
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { intent: 'GENERAL_CHAT' })), false);
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { intent: 'PERFORMANCE_REQUEST' })), false);
  assert.equal(isSharedAcademicCandidate({ ...base('x'), messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }), false);
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { hasImage: true })), false);
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { quizMode: true })), false);
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { onboarding: { a: 1 } })), false);
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { examMode: 'mock-running' })), false);
  assert.equal(isSharedAcademicCandidate(base('সন্ধি কী?', { fresh: false, recalled: true })), false);
  assert.equal(isSharedAcademicCandidate(base('ক'.repeat(301))), false);
});

test('the strict P25 rule is unchanged', () => {
  assert.equal(isCacheableRequest({ messages: [{ role: 'user', content: 'সন্ধি কী?' }], intent: 'ACADEMIC_EXPLAIN', memoryText: 'x' }), false);
  assert.equal(isCacheableRequest({ messages: [{ role: 'user', content: 'সন্ধি কী?' }], intent: 'ACADEMIC_EXPLAIN' }), true);
});

test('a shared answer is produced from an impersonal prompt only', () => {
  assert.ok(SRC.includes("sys = [buildSystemPrompt({ stats: null, examMode: '', quiz: false, onboarding: null, prefs: null }), RESPONSE_FORMAT_RULES].join('\\n\\n');"));
  assert.ok(SRC.includes("if (cacheMode === 'shared') {"));
  assert.ok(SRC.includes('msgs = v.messages.slice();'));
});

test('first-chunk timeout defaults to 5 s and stays overridable', () => {
  assert.ok(SRC.includes('Number(env && env.AGENT_FIRST_CHUNK_MS) || 5000)'));
  assert.ok(!SRC.includes('Number(env && env.AGENT_FIRST_CHUNK_MS) || 10000)'));
});

test('memory saves are off the hot path but still awaited inside the request', () => {
  assert.ok(SRC.includes("later(() => finalize(c.model, c.provider, full));"));
  assert.ok(SRC.includes("later(() => finalize(c.model, c.provider, raw));"));
  assert.ok(SRC.includes('if (lastTopicWrite) await lastTopicWrite;'));
  /* F0.4 replaced the hand-built frames with the sky-stream-v1 writer, so the
     done frame is now emitted by `s.done(...)` rather than a raw push. The
     invariant is unchanged -- the student's answer is complete before the
     memory save starts -- so the check follows the writer, not the old literal. */
  const done = SRC.indexOf('s.done({ rid, model: c.model');
  const fin = SRC.indexOf('later(() => finalize(c.model, c.provider, full));');
  assert.ok(done > 0 && fin > done, 'done is pushed before the memory save starts');
  assert.ok(SRC.indexOf('await settleBackground();', fin) > fin);
});

test('timings are logged as numbers only', () => {
  assert.ok(SRC.includes("evt: 'ai.timing'"));
  for (const m of ["mark('quota')", "mark('context')", "mark('modelStart')", "mark('firstToken')", "mark('modelDone')"]) assert.ok(SRC.includes(m), m);
});
