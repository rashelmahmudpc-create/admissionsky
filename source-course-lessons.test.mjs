/* Phase 2 M2 — lesson instrumentation on the live course surface.
 *
 * `source-course-tool.js` loads a supplied course document and mirrors the
 * source's OWN lesson UI onto the analytics bus. These tests boot the real tool
 * against the real sandhi course HTML (not a stub), so the selectors
 * (`section.lesson-sec`, `button.done-btn[data-lesson]`) are the ones students
 * actually get. A rename in the course HTML fails here, not silently in GA4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const TOOL = readFileSync(new URL('./source-course-tool.js', import.meta.url), 'utf8');
const COURSE_HTML = readFileSync(new URL('./courses/sandhi/index.html', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(predicate, label, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function boot(route = 'source-courses/sandhi', options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"><div class="page"><div class="topbar"></div></div></div></body></html>', {
    url: `https://admissionhub.pages.dev/#${route}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  /* jsdom ships no WebCrypto, so the tool's SHA-256 integrity check would
   * always fail here and every course would silently lose its interactivity —
   * masking the very behaviour these tests cover. Bridge node's WebCrypto in. */
  if (!window.crypto.subtle) {
    Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  }
  window.activities = [];
  window.addEventListener('admission:activity', e => window.activities.push(e.detail));
  window.navigate = () => {};
  window.renderShell = (html) => {
    const page = window.document.querySelector('#app .page');
    page.innerHTML = `<div class="topbar"></div>${html}`;
  };
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/courses/sandhi/')) return { ok: true, status: 200, text: async () => options.courseHtml || COURSE_HTML };
    return { ok: false, status: 404, text: async () => '' };
  };
  if (options.intersectionObserver) {
    /* jsdom has no IntersectionObserver, so the real phone path (the observer,
     * not the fallback) is otherwise never exercised. Capture the config and
     * the observed sections so a tall-section threshold regression fails here. */
    window.__io = { options: null, observed: [], fire: () => {} };
    window.IntersectionObserver = class {
      constructor(callback, opts) {
        window.__io.options = opts;
        window.__io.fire = () => this._cb([{ isIntersecting: true, target: window.__io.observed[0] }]);
        this._cb = callback;
      }
      observe(el) { window.__io.observed.push(el); }
      unobserve() {}
      disconnect() {}
    };
  }
  window.eval(TOOL);
  assert.ok(window.renderSourceCourseTool, 'tool must install its renderer');
  window.renderSourceCourseTool();
  return window;
}

const typesOf = (window, type) => window.activities.filter(a => a.type === type);
const clickOn = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

test('m2-1: opening a source course fires course_view and course_start once', async () => {
  const window = await boot();
  assert.equal(typesOf(window, 'COURSE_VIEW').length, 1);
  assert.equal(typesOf(window, 'COURSE_START').length, 1);
  assert.equal(typesOf(window, 'COURSE_VIEW')[0].courseId, 'sandhi-exact-native-v1');
});

test('m2-2: the real course HTML exposes the lesson selectors this feature depends on', () => {
  const dom = new JSDOM(COURSE_HTML);
  const doc = dom.window.document;
  const sections = doc.querySelectorAll('section.lesson-sec[id]');
  const buttons = doc.querySelectorAll('.done-btn[data-lesson]');
  assert.ok(sections.length >= 8, `expected the sandhi lessons, found ${sections.length}`);
  assert.equal(buttons.length, sections.length, 'every lesson section has its "পড়া শেষ" button');
  /* The section ids and the button data-lesson values must line up, otherwise
   * lesson_view and lesson_complete would report different lesson ids. */
  const sectionIds = [...sections].map(s => s.id).sort();
  const buttonIds = [...buttons].map(b => b.getAttribute('data-lesson')).sort();
  assert.deepEqual(buttonIds, sectionIds);
});

test('m2-3: marking a lesson complete emits lesson_complete with the source lesson id', async () => {
  const window = await boot();
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  const btn = await waitFor(() => host.querySelector('.done-btn[data-lesson="lesson3"]'), 'lesson 3 button');
  clickOn(window, btn);
  const done = await waitFor(() => typesOf(window, 'LESSON_COMPLETE')[0], 'lesson_complete signal');
  assert.equal(done.courseId, 'sandhi-exact-native-v1');
  assert.equal(done.lessonId, 'lesson3');
  assert.equal(done.lessonNumber, 3);
  assert.equal(done.completionPercent, 100);
});

test('m2-4: un-marking a lesson does NOT re-emit lesson_complete', async () => {
  const window = await boot();
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  const btn = await waitFor(() => host.querySelector('.done-btn[data-lesson="lesson1"]'), 'lesson 1 button');
  clickOn(window, btn); // on
  await waitFor(() => typesOf(window, 'LESSON_COMPLETE').length === 1, 'first complete');
  clickOn(window, btn); // off — the source toggles the button back
  await sleep(30);
  assert.equal(typesOf(window, 'LESSON_COMPLETE').length, 1, 'a toggle-off must not emit a second completion');
});

test('m2-5: completing every lesson fires course_complete exactly once', async () => {
  const window = await boot();
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  const buttons = await waitFor(() => {
    const list = host.querySelectorAll('.done-btn[data-lesson]');
    return list.length ? [...list] : null;
  }, 'lesson buttons');
  for (const btn of buttons) clickOn(window, btn);
  await waitFor(() => typesOf(window, 'COURSE_COMPLETE').length === 1, 'course_complete');
  assert.equal(typesOf(window, 'LESSON_COMPLETE').length, buttons.length, 'each lesson reported once');
  const complete = typesOf(window, 'COURSE_COMPLETE')[0];
  assert.equal(complete.courseId, 'sandhi-exact-native-v1');
  assert.equal(complete.lessonCount, buttons.length);
  /* Clicking the already-complete buttons again must not add a second row. */
  for (const btn of buttons) clickOn(window, btn);
  await sleep(30);
  assert.equal(typesOf(window, 'COURSE_COMPLETE').length, 1);
});

test('m2-6: the courses library route emits no lesson signals', async () => {
  const window = await boot('source-courses');
  await sleep(30);
  assert.equal(typesOf(window, 'LESSON_COMPLETE').length, 0);
  assert.equal(typesOf(window, 'COURSE_COMPLETE').length, 0);
});

test('m2-7: the lesson observer uses threshold 0 so tall sections can ever fire', async () => {
  const window = await boot('source-courses/sandhi', { intersectionObserver: true });
  await waitFor(() => window.document.querySelector('.source-native-host .done-btn[data-lesson]'), 'course host');
  const opts = window.__io.options;
  assert.ok(opts, 'the tool must install an IntersectionObserver on the real DOM path');
  /* A lesson section on a phone is taller than the viewport, so a non-zero
   * ratio can never be reached — lesson_view would fire for nobody. */
  assert.equal(opts.threshold, 0, 'threshold must be 0 for sections taller than the viewport');
  assert.equal(window.__io.observed.length, 8, 'every lesson section must be observed');
});

test('m2-8: an intersecting lesson emits lesson_view and lesson_start', async () => {
  const window = await boot('source-courses/sandhi', { intersectionObserver: true });
  await waitFor(() => window.document.querySelector('.source-native-host .done-btn[data-lesson]'), 'course host');
  window.__io.fire();
  const view = await waitFor(() => typesOf(window, 'LESSON_VIEW')[0], 'lesson_view signal');
  assert.equal(view.lessonId, 'lesson1');
  assert.equal(view.lessonNumber, 1);
  assert.equal(typesOf(window, 'LESSON_START').length, 1);
  /* Intersecting again must not re-report the same lesson. */
  window.__io.fire();
  await sleep(30);
  assert.equal(typesOf(window, 'LESSON_VIEW').length, 1);
});

/* ── Phase 2 M3 completion — the course MCQ engine is instrumented too ────── */

test('m3-1: answering a course MCQ emits question_attempt with the verdict and think-time', async () => {
  const window = await boot();
  await waitFor(() => window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'), 'first MCQ');
  /* Let the question sit on screen so the duration is a real elapsed time. */
  await sleep(1100);
  const first = window.document.querySelector('#nativeCourseQuizMount .q-opt-v2');
  clickOn(window, first);
  const attempt = await waitFor(() => typesOf(window, 'QUESTION_ATTEMPT')[0], 'question_attempt signal');
  assert.equal(attempt.quizId, 'sandhi-exact-native-v1:course');
  assert.equal(attempt.quizType, 'practice');
  assert.equal(typeof attempt.correct, 'boolean', 'the verdict is recorded');
  assert.ok(attempt.questionId, 'the question id is recorded');
  assert.ok(attempt.duration >= 1, `think-time must be real, got ${attempt.duration}`);
});

test('m3-2: a course MCQ attempt never carries the answer text or explanation', async () => {
  const window = await boot();
  await waitFor(() => window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'), 'first MCQ');
  clickOn(window, window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'));
  const attempt = await waitFor(() => typesOf(window, 'QUESTION_ATTEMPT')[0], 'question_attempt signal');
  const serialized = JSON.stringify(attempt);
  assert.equal(serialized.includes('options'), false);
  assert.equal(serialized.includes('explanation'), false);
  assert.equal('question' in attempt, false);
});

test('m3-3: re-answering an already-answered question does not emit a second attempt', async () => {
  const window = await boot();
  await waitFor(() => window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'), 'first MCQ');
  clickOn(window, window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'));
  await waitFor(() => typesOf(window, 'QUESTION_ATTEMPT').length === 1, 'first attempt');
  clickOn(window, window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'));
  await sleep(30);
  assert.equal(typesOf(window, 'QUESTION_ATTEMPT').length, 1, 'the source locks the answer; so must the count');
});

test('m3-4: reaching the result screen emits quiz_complete with accuracy and duration', async () => {
  const window = await boot();
  await waitFor(() => window.document.querySelector('#nativeCourseQuizMount .q-opt-v2'), 'first MCQ');
  /* Walk the whole set: answer, then Next until the result renders. */
  for (let i = 0; i < 60; i += 1) {
    const opt = window.document.querySelector('#nativeCourseQuizMount .q-opt-v2:not([disabled])');
    if (opt) clickOn(window, opt);
    const next = [...window.document.querySelectorAll('.native-course-quiz-nav button')].find(b => /Next|Result/i.test(b.textContent || ''));
    if (!next) break;
    clickOn(window, next);
    await sleep(5);
    if (typesOf(window, 'QUIZ_COMPLETE').length) break;
  }
  const done = await waitFor(() => typesOf(window, 'QUIZ_COMPLETE')[0], 'quiz_complete signal');
  assert.equal(done.quizId, 'sandhi-exact-native-v1:course');
  assert.equal(done.quizType, 'practice');
  assert.equal(typeof done.accuracy, 'number');
  assert.ok(done.questionCount > 0);
  assert.equal(typesOf(window, 'QUIZ_COMPLETE').length, 1, 'a result screen is reported once');
});

test('security: a tampered course document cannot inject markup either', async () => {
  /* Gating `scripts` alone left the other half open: payload.bodyHtml was still
   * injected with host.innerHTML, so an <img onerror> in a tampered document ran
   * in the app origin without any script ever being compiled. The markup must be
   * dropped by the same integrity flag. */
  const tampered = COURSE_HTML.replace('<body>', '<body><img src=x onerror="window.__htmlPwned=1">');
  assert.notEqual(tampered, COURSE_HTML, 'the tamper fixture must actually differ');
  const window = await boot('source-courses/sandhi', { courseHtml: tampered });
  await sleep(400);
  assert.equal(window.__htmlPwned, undefined, 'tampered markup must not be injected');
  assert.ok(window.document.body.innerHTML.includes('যাচাই করা যায়নি'), 'the student sees a mismatch notice');
});

test('security: a tampered course document renders but its scripts never execute', async () => {
  /* The course scripts run through new Function() in the app origin, so an
   * altered document would be stored XSS. The SHA-256 in COURSE_DEFS must
   * therefore gate execution: change one byte and the payload must not run. */
  const tampered = COURSE_HTML.replace('var MCQ = [', 'window.__pwned = 1; var MCQ = [');
  assert.notEqual(tampered, COURSE_HTML, 'the tamper fixture must actually differ');
  const window = await boot('source-courses/sandhi', { courseHtml: tampered });
  await sleep(400);
  assert.equal(window.__pwned, undefined, 'tampered course scripts must not execute');
  assert.equal(typesOf(window, 'QUESTION_ATTEMPT').length, 0, 'no quiz behaviour from an unverified document');
});

test('production: the Cloudflare Pages analytics beacon does not disable a course', async () => {
  /* Cloudflare Pages appends its beacon to every served HTML document, so the
   * bytes the browser receives are never the bytes in the repository. Hashing
   * the response as-is made the integrity pin fail in production only -- every
   * course kept rendering but silently lost its scripts, while these tests
   * passed because they read the file from disk. Measured live 2026-10-24:
   * /courses/sandhi/ differs from the repo file by exactly this one line. */
  const beacon = `<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "1cd9675a9c374f478b623367a1470aa4"}'></script><!-- Cloudflare Pages Analytics -->`;
  const served = COURSE_HTML.replace('</body>', `${beacon}</body>`);
  assert.notEqual(served, COURSE_HTML, 'the beacon fixture must actually differ');
  const window = await boot('source-courses/sandhi', { courseHtml: served });
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  assert.ok(host.querySelector('.done-btn[data-lesson="lesson3"]'), 'a beacon-appended course keeps its scripts');
  assert.equal(typesOf(window, 'COURSE_VIEW').length, 1);
});

