// P08-AC5 — state-preservation (AC1 রিফ্রেশ-রিকভারি · AC2 অটো-সেভ · AC4 নেটওয়ার্ক-ফেল) কোর-টেস্ট
// AC3 টাইমার-অটো-সাবমিট p08-exam-ac3.test.mjs-এ; এখানে state-সংরক্ষণ/পুনরুদ্ধার।
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const H = readFileSync('index.html', 'utf8');
const PH = readFileSync('performance-hardening.js', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

/* ১ — AC2: প্রতি-উত্তর অটো-সেভ (IDB debounced + per-tap backup) */
t('queueExamPersist: 180ms debounce-এ IDB-পার্সিস্ট', /function queueExamPersist\(\) \{[\s\S]{0,200}?examPersistTimer = window\.setTimeout\(flushExamPersist, 180\)/.test(PH));
t('flushExamPersist: dirty-ফ্ল্যাগসহ await dbPut(\'exams\')', /async function flushExamPersist\(\) \{[\s\S]{0,300}?await dbPut\('exams', exam\)/.test(PH));
t('NS এক্সপোজ: queueExamPersist + flushExamPersist', PH.includes('NS.queueExamPersist = queueExamPersist') && PH.includes('NS.flushExamPersist = flushExamPersist'));
t('উত্তর-ফাংশন wrap: selectMockAnswer/selectFlashAnswer/selectTopicAnswer', /\[\s*'selectMockAnswer',\s*'selectFlashAnswer',\s*'selectTopicAnswer'\s*\]\.forEach\(wrapAnswerFunction\)/.test(PH));
t('wrapAnswerFunction: tap-এ backupExamState(after:)', /backupExamState\(`after:\$\{name\}`\)/.test(PH));
t('exam-বাকী ফিল্ড: selectedAnswers+currentIndex+timing+bookmarks+flags', /selectedAnswers: \{\.\.\.\(exam\.selectedAnswers \|\| \{\}\)\}/.test(PH) && /currentIndex: Number\(exam\.currentIndex \|\| 0\)/.test(PH) && /timing: \{\.\.\.\(exam\.timing \|\| \{\}\)\}/.test(PH) && /bookmarks: Array\.from\(exam\.bookmarks \|\| \[\]\)/.test(PH));
t('EXAM_BACKUP_KEY sessionStorage (emergency backup)', PH.includes("'admissionHub:performance:activeExamBackup:v1'") && PH.includes('sessionStorage.setItem(EXAM_BACKUP_KEY'));

/* ২ — AC2+AC1: pagehide/visibilitychange → IDB-flush-চেষ্টা + backup */
t('pagehide: flushExamPersist + backupExamState(\'pagehide\')', /on\(window, 'pagehide', \(\) => \{ try \{ flushExamPersist\(\); \} catch \(_\) \{\} backupExamState\('pagehide'\)/.test(PH));
t('visibilitychange hidden: flush + backupExamState(\'hidden\')', /if \(document\.visibilityState !== 'visible'\) \{ try \{ flushExamPersist\(\); \} catch \(_\) \{\} backupExamState\('hidden'\)/.test(PH));

/* ৩ — AC1: resume-পথে backup-merge */
t('applyExamBackup ফাংশন (emergency-backup → resumed-exam merge)', H.includes('function applyExamBackup(exam)'));
t('applyExamBackup: id-মিল + selectedAnswers/currentIndex/timing merge', /String\(bk\.exam\.id\)!==String\(exam\.id\)\) return exam/.test(H) && /exam\.selectedAnswers=\{\.\.\.\(exam\.selectedAnswers\|\|\{\}\), \.\.\.b\.selectedAnswers\}/.test(H) && /exam\.currentIndex=b\.currentIndex/.test(H));
t('boot-resume: ActiveExam=applyExamBackup(resumable)', H.includes('ActiveExam=applyExamBackup(resumable)'));
t('resumeActiveExam: applyExamBackup(ActiveExam)', /function resumeActiveExam\(\)\{[\s\S]{0,80}?if\(ActiveExam\) ActiveExam=applyExamBackup\(ActiveExam\)/.test(H));
t('checkResumableExam: CACHE.exams status===\'running\'-থেকে', /CACHE\.exams\.filter\(e=>e\.status==='running'\)/.test(H));
t('Resume-মোডাল: answered-count + Discard/Resume', H.includes('Resume Active Exam?') && H.includes('onclick="discardActiveExam()"') && H.includes('onclick="resumeActiveExam()"'));
t('discardActiveExam: retry-clear + dbDel + নেভিগেশন', /clearTimeout\(submitRetryHandle\)/.test(H) && /await dbDel\('exams', ActiveExam\.id\)/.test(H));

/* ৪ — AC4: submit-পথ সম্পূর্ণ local (নেটওয়ার্ক-কল নেই) */
const subStart = H.indexOf('async function submitExam(autoSubmit)');
const subEnd = H.indexOf('navigate(e.mode===\'flash\'', subStart);
const subBody = H.slice(subStart, subEnd > 0 ? subEnd : subStart + 10000);
t('submitExam-body: কোনো fetch/api/XMLHttpRequest নেই (ডেটা local-first)', !/fetch\(|XMLHttpRequest|\/api\//.test(subBody));
t('submitExam: isSubmitting গার্ড + clearExamTimers', /if\(!e \|\| e\.isSubmitting\) return;/.test(H) && /clearExamTimers\(\);/.test(H));
t('submitExam: fail → retry (ব্যাকঅফ+examId-গার্ড) — AC4', H.includes('submitRetryAttempt<6') && /cur\.id===examId && cur\.status==='running'/.test(H));
t('submitExam: সফল-পথে status=\'completed\' + dbPut + result-নেভিগেট', /e\.status='completed';/.test(H) && /await dbPut\('exams', e\);/.test(H) && /navigate\(e\.mode==='flash' \? 'exam\/flash-summary' : 'exam\/result'\)/.test(H));

/* ৫ — AC3 regression: টাইমার-শেষ অটো-সাবমিট অক্ষত */
t('examTimerTick: remaining<=0 → submitExam(true) [AC3-regression]', /if\(remaining<=0\)\{[\s\S]{0,120}?await submitExam\(true\)/.test(H));

/* ৬ — ভার্সন-ট্র্যাকিং v193 + ক্যাশ-কী (performance-hardening ?v=2) */

t('sw BUILD_ID current shell', SW.includes("const BUILD_ID = 'v364-sky-goal'"));
t('index sw-marker current shell', H.includes("const expectedSwVersion = 'v364-sky-goal'"));
t('performance-hardening.js?v=2 deferred; lean startup shell excludes it', H.includes('<script defer src="performance-hardening.js?v=2"></script>') && !SW.includes("'./performance-hardening.js?v=2'"));

console.log(`\nP08-STATE-PRESERVE: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
