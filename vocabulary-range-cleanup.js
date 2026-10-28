/* One-time, scope-locked cleanup requested for the installed PWA.
 * It never touches other subjects/topics and keeps a local backup before deletion.
 */
(function () {
  'use strict';

  const RUN_ID = 'vocabulary-1-100-question-range-cleanup-v1';
  const BACKUP_ID = 'backup-' + RUN_ID;
  const START = 101;
  const END = 547;
  const EXPECTED = END - START + 1;

  const normalize = value => String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ');

  const isMemorizing = value => {
    const name = normalize(value);
    return name === 'memorizing' || name === 'memorising' || name.includes('memorizing') || name.includes('memorising');
  };

  const isVocabulary100 = value => {
    const name = normalize(value);
    return /^vocabulary\s*1\s*-\s*100$/.test(name) || /^vocabulary\s*1\s*to\s*100$/.test(name);
  };

  const standaloneApp = () => Boolean(
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true)
  );

  async function run() {
    try {
      if (!standaloneApp()) {
        console.info('[Admission Hub] Vocabulary cleanup skipped outside the installed standalone app.');
        return;
      }
      if (window.__admissionBootPromise && typeof window.__admissionBootPromise.then === 'function') {
        await window.__admissionBootPromise;
      }
      if (window.__admissionBootStatus !== 'ready' || typeof dbGetAll !== 'function' || typeof dbPut !== 'function' || typeof dbDel !== 'function') return;

      const appMeta = await dbGetAll('appMeta');
      if (appMeta.some(item => item && item.id === RUN_ID && item.completedAt)) return;

      const [subjects, topics, questions] = await Promise.all([
        dbGetAll('subjects'),
        dbGetAll('topics'),
        dbGetAll('questions')
      ]);

      const memorizing = subjects.filter(subject => isMemorizing(subject.name));
      if (memorizing.length !== 1) {
        console.warn('[Admission Hub] Vocabulary cleanup skipped: expected exactly one Memorizing subject.', memorizing.map(x => x.name));
        return;
      }

      const roots = topics.filter(topic => topic.subjectId === memorizing[0].id && isVocabulary100(topic.name));
      if (roots.length !== 1) {
        console.warn('[Admission Hub] Vocabulary cleanup skipped: expected exactly one Vocabulary 1–100 topic.', roots.map(x => x.name));
        return;
      }

      // The Question Bank UI numbers cards by their position in the exact topic list
      // (see getSerialMap in question-bank-performance.js), not by questionNumber.
      // Keep the same IndexedDB order used by loadCache and target this topic only;
      // descendants must not be folded into the range.
      const topicQuestions = questions.filter(question => question.subjectId === memorizing[0].id && question.topicId === roots[0].id);
      if (topicQuestions.length !== END) {
        console.warn('[Admission Hub] Vocabulary cleanup skipped: expected exactly 547 questions in the target topic.', {
          found: topicQuestions.length,
          expected: END
        });
        return;
      }
      const candidates = topicQuestions.slice(START - 1, END);
      if (candidates.length !== EXPECTED) {
        console.warn('[Admission Hub] Vocabulary cleanup skipped: displayed 101–547 range is incomplete.', {
          found: candidates.length,
          expected: EXPECTED
        });
        return;
      }
      const verifiedNumbers = Array.from({ length: EXPECTED }, (_, index) => START + index);

      const backup = {
        id: BACKUP_ID,
        type: 'question-range-cleanup-backup',
        createdAt: Date.now(),
        subjectId: memorizing[0].id,
        subjectName: memorizing[0].name,
        topicId: roots[0].id,
        topicName: roots[0].name,
        start: START,
        end: END,
        records: candidates
      };
      await dbPut('appMeta', backup);

      for (const question of candidates) await dbDel('questions', question.id);

      await dbPut('appMeta', {
        id: RUN_ID,
        completedAt: Date.now(),
        deleted: candidates.length,
        expected: EXPECTED,
        verifiedNumbers,
        subjectId: memorizing[0].id,
        topicId: roots[0].id,
        start: START,
        end: END
      });

      if (typeof loadCache === 'function') await loadCache();
      if (typeof window.__admissionRenderRoute === 'function') window.__admissionRenderRoute();
      if (typeof toast === 'function') toast(`${candidates.length}টি প্রশ্ন মুছে ফেলা হয়েছে, Vocabulary 1–100 · 101–547`);
      console.info('[Admission Hub] Vocabulary range cleanup completed.', { deleted: candidates.length, expected: EXPECTED, verifiedNumbers });
    } catch (error) {
      console.error('[Admission Hub] Vocabulary range cleanup failed; no completion marker was written.', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
