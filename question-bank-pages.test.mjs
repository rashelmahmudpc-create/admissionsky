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

test('a topic page links up to the hub, not only sideways to its siblings', () => {
  /* The defect this guards, measured on the live site 2026-11-03: the hub linked
   * down to all 14 topics, and every topic linked sideways to the other 13 — but
   * none linked back to the hub. The breadcrumb's middle step pointed at
   * `/#question-bank`, a hash route, so a crawler could not follow it. The hub
   * was reachable from the sitemap and from nowhere else.
   *
   * That is the same dead-end shape the course pages had, and it is easy to miss
   * because the page LOOKS navigable: the breadcrumb says "Admission Sky ›
   * প্রশ্নব্যাংক › <topic>", and only the middle word is unfollowable. */
  const { dist } = generate();
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const topic = content.topics[0];
  const folder = readdirSync(join(dist, 'question-bank')).find(n => n.startsWith(topic.id));
  const page = read(dist, 'question-bank', folder, 'index.html');

  const links = new Set([...page.matchAll(/<a[^>]*href="([^"]+)"/g)].map(m => m[1]));
  assert.ok(links.has('/question-bank/'),
    'a topic page must link to the hub with a real path a crawler can follow');
  assert.ok(links.has('/'), 'and back to the site');

  // And no breadcrumb step may point at a fragment: a crawler cannot follow one.
  const nav = page.match(/<nav>([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'the page has a breadcrumb');
  for (const href of [...nav[1].matchAll(/href="([^"]+)"/g)].map(m => m[1])) {
    assert.ok(!href.includes('#'), `the breadcrumb links to a fragment (${href}), which a crawler cannot follow`);
  }
});

test('a question bank page links out to the rest of the site', () => {
  /* Measured on the live site 2026-11-03: a topic page linked to the hub, to its
   * 13 siblings, and to nothing else — no course, no about, no contact. The hub
   * linked only to its own topics. A crawler entering the bank could not leave
   * it, and a student who arrived from a question search had no path to the
   * courses that are the site's other half.
   *
   * Checked on every generated page, because the footer is written in two
   * templates (the hub and the topics) and only one of them going stale is
   * exactly the kind of half-fix this repository keeps finding. */
  const { dist } = generate();
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const topic = content.topics[0];
  const folder = readdirSync(join(dist, 'question-bank')).find(n => n.startsWith(topic.id));

  const pages = [
    ['hub', read(dist, 'question-bank', 'index.html')],
    ['topic', read(dist, 'question-bank', folder, 'index.html')],
  ];
  const REQUIRED = ['/', '/about.html', '/contact.html', '/privacy.html', '/courses/sandhi/'];
  for (const [what, page] of pages) {
    const links = new Set([...page.matchAll(/<a[^>]*href="([^"]+)"/g)].map(m => m[1]));
    for (const href of REQUIRED) {
      assert.ok(links.has(href), `the ${what} page does not link to ${href}`);
    }
  }
});

test('every generated title fits what a search result shows', () => {
  /* Measured on the live site 2026-11-03: three topic pages had titles of 68-75
   * characters, because the topic names carry emoji. A result past roughly 60
   * characters is cut with an ellipsis, and the cut lands in the middle of the
   * topic name — the one part a student is scanning for.
   *
   * The suffix is what makes the title legible in a list, so it is kept and the
   * name is trimmed. Checked on every generated page rather than the three that
   * were long, because the next topic the owner adds will have its own length. */
  const { dist, } = generate();
  const content = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const LIMIT = 60;

  const pages = [['hub', join(dist, 'question-bank', 'index.html')]];
  for (const topic of content.topics) {
    const folder = readdirSync(join(dist, 'question-bank')).find(n => n.startsWith(topic.id));
    pages.push([topic.id, join(dist, 'question-bank', folder, 'index.html')]);
  }

  for (const [what, file] of pages) {
    const page = readFileSync(file, 'utf8');
    const title = page.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    assert.ok(title, `${what} has no title`);
    assert.ok(title.length <= LIMIT, `${what} title is ${title.length} chars: ${title}`);
    // The share card is the same title, so it has the same limit.
    const og = page.match(/property="og:title" content="([^"]*)"/)?.[1] ?? '';
    assert.ok(og.length <= LIMIT, `${what} og:title is ${og.length} chars`);
  }
});

test('a malformed question cannot stop the whole bank from publishing', () => {
  /* The bug this guards, found 2026-11-03 by feeding the generator bad content:
   * an answer index outside the options list raised IndexError, which aborted
   * the script. The deploy wraps it in `|| echo`, so the deploy stayed green and
   * all fifteen pages silently stopped publishing — one malformed question in
   * the owner's console would have taken the entire question bank off the site.
   *
   * A question whose answer cannot be resolved is still worth publishing: the
   * question and its options are what a student searched for. Only the answer is
   * omitted. */
  const BAD = [
    { name: 'out of range', question: { id: 'q1', topicId: 't1', question: 'Q?', options: ['a'], answer: 9 } },
    { name: 'negative', question: { id: 'q1', topicId: 't1', question: 'Q?', options: ['a'], answer: -1 } },
    { name: 'not a number', question: { id: 'q1', topicId: 't1', question: 'Q?', options: ['a'], answer: 'x' } },
    { name: 'null', question: { id: 'q1', topicId: 't1', question: 'Q?', options: ['a'], answer: null } },
    { name: 'no options', question: { id: 'q1', topicId: 't1', question: 'Q?', options: [], answer: 0 } },
    { name: 'no answer', question: { id: 'q1', topicId: 't1', question: 'Q?' } },
  ];
  const content = {
    subjects: [{ id: 's1', name: 'S' }],
    topics: [{ id: 't1', name: 'T', subjectId: 's1' }],
    questions: BAD.map(b => b.question),
  };

  const dist = mkdtempSync(join(tmpdir(), 'qb-bad-'));
  const fixture = join(dist, 'content.json');
  writeFileSync(fixture, JSON.stringify(content));

  let output = '';
  assert.doesNotThrow(() => {
    output = execFileSync('python3', [GENERATOR, '--dist', dist, '--content', fixture], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, 'a malformed question must not abort the generator');

  // And the pages are still produced — the point of not aborting.
  assert.match(output, /question bank: \d+ pages/);
  const folder = readdirSync(join(dist, 'question-bank')).find(n => n.startsWith('t1'));
  const page = readFileSync(join(dist, 'question-bank', folder, 'index.html'), 'utf8');
  const graph = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const faq = graph.find(n => n['@type'] === 'FAQPage');
  assert.ok(faq, 'the page still carries its FAQ');

  // Every entry has an answer field; the unresolvable ones are empty rather than
  // guessed at.
  for (const entry of faq.mainEntity) {
    assert.equal(typeof entry.acceptedAnswer.text, 'string', 'every entry has a text field');
    assert.equal(entry.acceptedAnswer.text, '', 'an unresolvable answer is empty, never a guess');
  }
});
