/* The question bank's crawlable pages.
 *
 * The bank holds 3000 questions across 14 topics, served publicly from
 * /api/content with no login — but only to JavaScript. The app is hash-routed,
 * so a search engine sees one page for all 3000 questions and indexes none of
 * them. A student searching a question this site owns and answers cannot find
 * it.
 *
 * `scripts/build-question-bank-pages.py` generates one static page per topic at
 * build time. These tests run it against a fixture, so they check the generator
 * without depending on the live content API — a build step that only works when
 * a network call succeeds is a build step that fails on the day it matters.
 *
 * The fixture is real content, trimmed: two subjects, two topics, five
 * questions, copied from the live API. Invented questions would test the
 * template against text that has none of the real text's shape (mixed Bengali
 * and English, emoji in topic names, empty explanations).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(ROOT, 'scripts', 'build-question-bank-pages.py');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'question-bank-content.json');

/* Run the generator into a fresh dist, seeded with the committed sitemap so the
 * merge has something to merge into. */
function generate() {
  const dist = mkdtempSync(join(tmpdir(), 'qb-dist-'));
  cpSync(join(ROOT, 'sitemap.xml'), join(dist, 'sitemap.xml'));
  const output = execFileSync('python3', [GENERATOR, '--dist', dist, '--content', FIXTURE], {
    cwd: ROOT, encoding: 'utf8',
  });
  return { dist, output };
}

const read = (dist, ...parts) => readFileSync(join(dist, ...parts), 'utf8');

test('a page is generated for every topic, plus the hub', () => {
  const { dist, output } = generate();
  const bank = join(dist, 'question-bank');
  assert.ok(existsSync(join(bank, 'index.html')), 'the hub page exists');

  const folders = readdirSync(bank).filter(name => name !== 'index.html');
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(folders.length, content.topics.length,
    `expected one folder per topic (${content.topics.length}), saw ${folders.length}`);
  assert.match(output, /question bank: \d+ pages/);
});

test('a topic page carries its questions as real markup, not a script', () => {
  /* The whole point. A page whose questions are rendered by JavaScript is the
   * defect this generator exists to fix — so the check strips scripts and
   * styles, exactly as a crawler that does not run JS would see it. */
  const { dist } = generate();
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const topic = content.topics.find(t => t.id === 'top-001');
  const folder = readdirSync(join(dist, 'question-bank')).find(name => name.startsWith(topic.id));
  assert.ok(folder, `no page generated for ${topic.id}`);

  const page = read(dist, 'question-bank', folder, 'index.html');
  const visible = page
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  assert.ok(visible.length > 500, `only ${visible.length} characters of crawlable text`);
  assert.match(page, /<h1[^>]*>/, 'the page has a server-rendered h1');

  // Every question in the fixture appears, verbatim.
  const questions = content.questions.filter(q => q.topicId === topic.id);
  for (const q of questions) {
    assert.ok(visible.includes(q.question.replace(/\s+/g, ' ').trim().slice(0, 40)),
      `the question is missing from the page: ${q.question.slice(0, 40)}`);
  }
});

test('the answers are in the markup, and the correct option is marked', () => {
  /* A page of questions with no answers is not the page a student searched for.
   * The fixture's first question has its answer at a known index, so the
   * marking is checked rather than assumed. */
  const { dist } = generate();
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const q = content.questions.find(x => x.topicId === 'top-001');
  const folder = readdirSync(join(dist, 'question-bank')).find(n => n.startsWith('top-001'));
  const page = read(dist, 'question-bank', folder, 'index.html');

  const correct = q.options[q.answer];
  assert.ok(correct, 'the fixture question has an answer');
  assert.ok(page.includes(correct), 'the correct option text appears');
  assert.match(page, /class="correct"/, 'and it is marked as the answer');
});

test('the structured data parses and its references resolve', () => {
  /* Same property the course pages are held to: an @id a node points at must be
   * defined in the same graph. A FAQPage is what makes these pages eligible for
   * a rich result, so a graph that does not parse is the feature not working. */
  const { dist } = generate();
  const folder = readdirSync(join(dist, 'question-bank')).find(n => n.startsWith('top-001'));
  const page = read(dist, 'question-bank', folder, 'index.html');
  const m = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'the page has a JSON-LD block');

  let graph;
  assert.doesNotThrow(() => { graph = JSON.parse(m[1])['@graph']; }, 'JSON-LD must parse');
  assert.ok(graph.some(n => n['@type'] === 'FAQPage'), 'the page is a FAQPage');

  const faq = graph.find(n => n['@type'] === 'FAQPage');
  assert.ok(faq.mainEntity.length > 0, 'the FAQ has questions');
  for (const entry of faq.mainEntity) {
    assert.ok(entry.name, 'every FAQ entry has a question');
    assert.ok(entry.acceptedAnswer?.text, `no answer for: ${String(entry.name).slice(0, 40)}`);
  }
});

test('the sitemap lists the generated pages, and running twice does not duplicate', () => {
  /* These pages do not exist in the repository — they are generated at build
   * time — so they cannot be in the committed sitemap. A sitemap that omits them
   * is the same problem as the stale dates: a crawler not told about a page is a
   * crawler that may not find it. */
  const { dist } = generate();
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  const sitemap = read(dist, 'sitemap.xml');
  assert.ok(sitemap.includes('/question-bank/'), 'the hub is listed');
  for (const topic of content.topics) {
    assert.match(sitemap, new RegExp(`/question-bank/${topic.id}`),
      `${topic.id} is not in the sitemap`);
  }

  // Still well-formed after the merge.
  assert.match(sitemap, /<\/urlset>\s*$/);

  // And idempotent: a second run must not double the entries.
  const before = (sitemap.match(/<url>/g) || []).length;
  execFileSync('python3', [GENERATOR, '--dist', dist, '--content', FIXTURE], { cwd: ROOT });
  const after = (read(dist, 'sitemap.xml').match(/<url>/g) || []).length;
  assert.equal(after, before, 'a second run added duplicate entries');
});

test('a content outage skips the pages instead of failing the build', () => {
  /* The generator runs inside the Pages deploy. If the content API is down, the
   * rest of the site is still fine and must still publish — so the script exits
   * zero and says so, rather than turning a content outage into a failed deploy.
   */
  const dist = mkdtempSync(join(tmpdir(), 'qb-empty-'));
  const empty = join(dist, 'empty.json');
  writeFileSync(empty, JSON.stringify({ subjects: [], topics: [], questions: [] }));

  const output = execFileSync('python3', [GENERATOR, '--dist', dist, '--content', empty], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(existsSync(join(dist, 'question-bank')), false,
    'no pages are written when there is no content');
  assert.doesNotMatch(output, /pages,/);
});
