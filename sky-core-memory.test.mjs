/* Sky core memory v2 + get_app_features + daily-limit card (owner 2026-10-17). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSystemPrompt, SYSTEM_PROMPT_V, limitMessage } from './ai-agent.js';
import { getPrompt, validatePromptRegistry, BASE_PROMPT_ID } from './prompt-registry.js';
import { isAppFeatureQuestion, parseAppFeatures, loadAppFeatures, renderAppFeatures, APP_FEATURES_KV_KEY } from './sky-app-features.mjs';

const AGENT = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
const CHAT = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');

test('the core prompt is the AdmissionSky v2 memory', () => {
  const p = buildSystemPrompt({});
  assert.equal(BASE_PROMPT_ID, 'sky-core');
  assert.ok(p.includes('আমি Sky, AdmissionSky-এর AI সহায়ক।'));
  assert.ok(p.includes('Rashel Zayan'));
  assert.ok(p.includes('Always reply in Bengali'));
  assert.ok(!p.includes('You are Admission Sky AI'));
  assert.ok(p.length < 9000, 'memory stays inside the token budget');
  assert.equal(SYSTEM_PROMPT_V, 'sys-sky-v3-1-live-tools');
});

test('the old v1 prompt is kept, deprecated, never deleted', () => {
  const old = getPrompt('admission-hub-core');
  assert.ok(old && old.status === 'deprecated' && old.text.includes('You are Admission Sky AI'));
  assert.deepEqual(validatePromptRegistry(), []);
});

test('student-facing agent text no longer uses the old name', () => {
  assert.ok(!AGENT.includes('Admission Sky'));
});

test('get_app_features triggers only for questions about the app', () => {
  assert.ok(isAppFeatureQuestion('AdmissionSky-তে কী কী ফিচার আছে?'));
  assert.ok(isAppFeatureQuestion('এই অ্যাপ কেন ব্যবহার করব?'));
  assert.ok(isAppFeatureQuestion('what features does the app have'));
  assert.ok(!isAppFeatureQuestion('সমাস কী?'));
  assert.ok(!isAppFeatureQuestion('সন্ধি বিচ্ছেদ করো: বিদ্যালয়'));
});

test('a KV override replaces the list; junk falls back to the built-in list', async () => {
  assert.equal(parseAppFeatures('not json'), null);
  assert.equal(parseAppFeatures({ items: [] }), null);
  const kv = { get: async (k) => (k === APP_FEATURES_KV_KEY ? JSON.stringify({ version: 'x1', items: [{ name: 'নতুন', what: 'নতুন\nফিচার' }] }) : null) };
  const live = await loadAppFeatures(kv);
  assert.equal(live.version, 'x1');
  assert.ok(renderAppFeatures(live).includes('- নতুন: নতুন ফিচার'));
  const fallback = await loadAppFeatures({ get: async () => '{bad' });
  assert.ok(renderAppFeatures(fallback).includes('প্রশ্নব্যাংক ও MCQ'));
});

test('the feature list is attached with a real live stage and bypasses the cache', () => {
  assert.ok(AGENT.includes("stage('app-features'"));
  assert.ok(AGENT.includes('&& !appFeatureHit;'));
});

test('the 429 reply carries resetAt and a kind official message', () => {
  assert.ok(AGENT.includes("error: 'rate_limited'") && AGENT.includes('resetAt, retryAfterSec'));
  const now = Date.UTC(2026, 9, 17, 12, 0, 0);
  const msg = limitMessage(10, now + (3 * 60 + 12) * 60000, now);
  assert.ok(msg.includes('১০টি') && msg.includes('৩ ঘণ্টা ১২ মিনিট') && msg.includes('উত্তর দেবো'));
});

test('the chat renders the limit as its own calm card', () => {
  assert.ok(CHAT.includes("holder.errorKind = 'limit'"));
  assert.ok(CHAT.includes('function limitText(meta)'));
  assert.ok(CHAT.includes("(limit ? '🌙' : '⚠️')"));
});
