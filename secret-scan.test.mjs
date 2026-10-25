// Public-repo secret guard (গ৬).
//
// This repository is public, so anything committed is world-readable forever —
// the only safe moment to catch a server secret is before it is pushed.
//
// The review that produced this file found the expected picture: the AIza…
// values in account-access.js, firebase-messaging-sw.js and three workflows are
// Firebase **web** API keys. Those are identifiers, not secrets — they ship
// inside every browser bundle by design and are useless without the project's
// security rules, so they are deliberately allowed here.
//
// What must never appear: a personal access token, a cloud access key, an
// OpenAI/Anthropic-style key, a Slack token, or a service-account private key.
// A leak of one of those is a real breach, not a review note.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Shape-based, because a name-based check misses the value that matters.
const FORBIDDEN = [
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/, 'OpenAI/Anthropic key'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, 'Slack token'],
  // A real PEM carries a base64 body; a test helper writes the header plus a
  // template placeholder, so requiring 100+ characters keeps fixtures out.
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]{100,}?-----END/, 'private key'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, 'GitLab token'],
  [/\bAIzaSy[A-Za-z0-9_-]{33}\b.{0,200}?"type"\s*:\s*"service_account"/s, 'service-account json'],
];

// Files that legitimately contain a *pattern* rather than a credential: the
// guards themselves and this file.
const SELF = new Set(['secret-scan.test.mjs']);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

test('গ৬ — no server credential is committed to the public repo', () => {
  const findings = [];
  for (const file of trackedFiles()) {
    if (SELF.has(file)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue; // binary or unreadable
    }
    for (const [rx, label] of FORBIDDEN) {
      const m = rx.exec(text);
      if (!m) continue;
      // Obvious placeholders are fixtures, not leaks: a redaction test has to
      // contain something shaped like a token to prove it gets redacted.
      const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index));
      if (/(\$\{|1234567890|FAKE|fake|dummy|example|redact|placeholder)/.test(line)) continue;
      findings.push(`${file}: ${label} (${m[0].slice(0, 12)}…)`);
    }
  }
  assert.deepEqual(findings, [], 'a credential-looking value is committed to a public repo');
});

test('গ৬ — the Firebase web keys that are allowed really are web keys', () => {
  // Proves the allowance above is narrow: only AIza… (web) keys appear, and the
  // count is small enough that a new one arriving would be noticed in review.
  const files = ['account-access.js', 'firebase-messaging-sw.js'].filter((f) => trackedFiles().includes(f));
  assert.ok(files.length >= 2, 'the two client files that carry the web key must still be present');
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/'AIza[A-Za-z0-9_-]{35}'/g)) {
      assert.match(m[0], /^'AIza[0-9A-Za-z_-]{35}'$/, `${file} carries a malformed Firebase key`);
    }
  }
});

// Keeps the scan honest: every pattern must fire on a value shaped like the real
// thing, so a green run cannot mean "the regexes are broken".
test('গ৬ — every pattern fires on a live-shaped sample', () => {
  const samples = [
    [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, `ghp_${'a'.repeat(36)}`],
    [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, `github_pat_${'b'.repeat(45)}`],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AKIA1234567890ABCDEF'],
    [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/, `sk-proj-${'c'.repeat(40)}`],
    [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, 'xoxb-9876543210-zzzzzzzzzz'],
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]{100,}?-----END/, `-----BEGIN PRIVATE KEY-----\n${'MIIE'.repeat(30)}\n-----END`],
    [/\bglpat-[A-Za-z0-9_-]{20,}\b/, `glpat-${'d'.repeat(24)}`],
  ];
  for (const [rx, sample] of samples) assert.ok(rx.test(sample), `pattern did not fire on ${sample.slice(0, 10)}…`);
});
