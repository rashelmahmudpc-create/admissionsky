#!/usr/bin/env node
/* Admission Hub → Admission Sky, display text only.
 *
 * The owner asked for the old name gone from everywhere a student can see it.
 * The danger is not the rename, it is the collateral: the same words appear as
 * STORAGE KEYS, HTTP HEADERS, CACHE NAMES and DOMAIN NAMES, and changing one of
 * those does not rename the product — it loses a student's saved settings, stops
 * the notification API answering, or invalidates the service-worker cache.
 *
 * So this script replaces exactly one string — the capitalised, spaced
 * `Admission Hub`, which is how the product is named in prose — and refuses to
 * touch the lowercase `admission-hub` that every identifier is built from. The
 * two are different strings, and that difference is the whole safety of the job.
 *
 * It also skips the places where the capitalised form is still not prose:
 *   • the bundle files, which are generated — they get rebuilt, not edited;
 *   • anything mentioning a domain or a mail address;
 *   • `X-AH-App` values, which a server compares by equality.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.argv[2] || '.';
const APPLY = process.argv.includes('--apply');
/* The name appears in two cases, and both are the product's name rather than an
 * identifier: `Admission Hub` in prose, `ADMISSION HUB` in the styled headings
 * and kickers the student sees. Both are replaced, each with its own case so a
 * shouty heading does not become a quiet one. */
const REPLACEMENTS = Object.freeze([
  Object.freeze({ from: 'Admission Hub', to: 'Admission Sky' }),
  Object.freeze({ from: 'ADMISSION HUB', to: 'ADMISSION SKY' })
]);

/* Extensions worth touching. Anything else is data, a lockfile or an image. */
const EDITABLE = new Set(['.js', '.mjs', '.html', '.json', '.webmanifest', '.css', '.txt', '.md', '.toml', '.yml', '.yaml']);

/* Generated bundles. Editing them by hand is how they drift from their sources;
 * they are rebuilt from the files above, so they are skipped here. */
const GENERATED = [/^worker-bundle\.mjs$/, /^auth-worker-bundle\.mjs$/];

/* The script's own source names the old string as its input. Rewriting that
 * would leave it searching for something that no longer exists. */
const SELF = /^scripts\/rename-to-admission-sky\.mjs$/;

/* Historical records. These describe what the product was called at the time,
 * so rewriting them would make the history wrong rather than the product right —
 * and none of them reaches a student. */
const HISTORICAL = [/^docs\//, /^AGENT_RESUME/, /^AGENT_RESUME\.md$/, /^todo\.md$/, /^[A-Z][A-Z0-9_-]*\.md$/];

/* A line that names a domain or a mailbox — but only one where the DISPLAY form
 * is actually part of the address.
 *
 * My first version skipped any line containing a URL at all, which is how the
 * three most important pages (about, contact, privacy) kept the old name: they
 * are written as single lines, so the whole document was skipped to protect a
 * domain that never contained the display form in the first place. Every address
 * in this repo is lowercase and hyphenated (`admissionsky.pages.dev`,
 * `admissionhub.workers.dev`), and the string being replaced is capitalised with
 * a space — so it cannot be inside one.
 *
 * The check is now specific: only a line where the display form sits INSIDE a
 * URL or immediately before an `@` is refused. That is the shape that would
 * actually break, and it does not occur here. */
const ADDRESS_LIKE = new RegExp(
  `(?:https?://[^\\s\"'<>]*(?:${REPLACEMENTS.map(r => r.from).join('|')}))|(?:(?:${REPLACEMENTS.map(r => r.from).join('|')})[a-z0-9._-]*@)`,
  'i'
);

/* A line that sets or compares the app header. The value is an equality token,
 * not a label: `X-AH-App` must stay byte-identical or the API stops answering. */
const HEADER_LIKE = /X-AH-App/i;

const walk = dir => readdirSync(dir).flatMap(name => {
  if (name === 'node_modules' || name === '.git' || name === '.wrangler') return [];
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return walk(full);
  return [full];
});

const changes = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (!EDITABLE.has(extname(file))) continue;
  if (GENERATED.some(pattern => pattern.test(rel))) continue;
  if (SELF.test(rel)) continue;
  if (HISTORICAL.some(pattern => pattern.test(rel))) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!REPLACEMENTS.some(entry => text.includes(entry.from))) continue;

  const lines = text.split('\n');
  let touched = 0;
  const kept = [];
  const out = lines.map((line, index) => {
    if (!REPLACEMENTS.some(entry => line.includes(entry.from))) return line;
    // Refuse the dangerous lines, and say why rather than skipping silently.
    if (ADDRESS_LIKE.test(line)) { kept.push(`  line ${index + 1}: address-like, left alone`); return line; }
    if (HEADER_LIKE.test(line)) { kept.push(`  line ${index + 1}: app header, left alone`); return line; }
    let next = line;
    for (const entry of REPLACEMENTS) {
      touched += next.split(entry.from).length - 1;
      next = next.split(entry.from).join(entry.to);
    }
    return next;
  });
  if (!touched && !kept.length) continue;
  changes.push({ rel, touched, kept });
  if (APPLY && touched) writeFileSync(file, out.join('\n'));
}

const total = changes.reduce((sum, entry) => sum + entry.touched, 0);
console.log(`${APPLY ? 'REPLACED' : 'WOULD REPLACE'} ${total} occurrence(s) in ${changes.length} file(s)`);
for (const entry of changes.sort((a, b) => b.touched - a.touched)) {
  console.log(`  ${String(entry.touched).padStart(3)}  ${entry.rel}`);
  for (const note of entry.kept) console.log(note);
}
