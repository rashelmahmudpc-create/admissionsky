import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// AUTH V2.0 (owner 2026-10-31).
//
// wrangler.auth.toml deploys `auth-worker-bundle.mjs`, which is the *login*
// script. A workflow that uploads it without checking the committed bundle
// against a fresh build ships whatever bytes happen to be in the repo: an edit
// under auth-native/** can merge, the app bundle can be regenerated and pass
// its own check, and the live auth surface stays stale with every gate green.
//
// That is not hypothetical — `deploy-pages-worker.yml` did exactly this until
// this change. So the rule is stated generally and enforced by reading the
// workflows: whichever workflow deploys the auth Worker must also verify the
// auth bundle first. A new workflow that deploys it inherits the requirement
// automatically instead of quietly repeating the omission.
const WORKFLOW_DIR = new URL('./.github/workflows/', import.meta.url);

const read = name => readFileSync(new URL(name, WORKFLOW_DIR), 'utf8');

const workflows = () => readdirSync(WORKFLOW_DIR)
  .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map(name => ({ name, text: read(name) }));

// A deploy of the auth Worker: a wrangler invocation pointed at wrangler.auth.toml.
const deploysAuthWorker = text => /wrangler[^\n]*deploy[^\n]*--config\s+wrangler\.auth\.toml/.test(text)
  || /wrangler[^\n]*--config\s+wrangler\.auth\.toml[^\n]*deploy/.test(text);

const checksAuthBundle = text => /npm run check:auth-worker-bundle/.test(text);

test('every workflow that deploys the auth Worker verifies its bundle first', () => {
  const offenders = workflows()
    .filter(({ text }) => deploysAuthWorker(text) && !checksAuthBundle(text))
    .map(({ name }) => name);

  assert.deepEqual(offenders, [],
    `these workflows deploy wrangler.auth.toml without running check:auth-worker-bundle: ${offenders.join(', ')}`);
});

test('the rule is not vacuous: at least one workflow deploys it and is covered', () => {
  const covered = workflows().filter(({ text }) => deploysAuthWorker(text) && checksAuthBundle(text));
  assert.ok(covered.length >= 1,
    'no workflow deploys wrangler.auth.toml with the bundle check — the guard above proves nothing');
});

test('the workflow that publishes on every merge to main is covered', () => {
  const text = read('deploy-pages-worker.yml');
  assert.match(text, /on:[\s\S]*push:[\s\S]*branches:\s*\[main\]/,
    'this is the automatic publish path');
  assert.ok(deploysAuthWorker(text), 'it deploys the auth Worker');
  assert.ok(checksAuthBundle(text), 'and it must verify the auth bundle before uploading it');
});

test('the auth bundle check compares bytes rather than trusting a rebuild', () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const script = pkg.scripts['check:auth-worker-bundle'] || '';
  assert.match(script, /cmp -s auth-worker-bundle\.mjs/, 'the check must compare the committed file');
  assert.match(script, /esbuild/, 'and must build the comparison from source');
});
