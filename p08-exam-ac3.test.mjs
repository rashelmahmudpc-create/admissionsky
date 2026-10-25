// P08-AC3 — টাইমার-শেষে অটো-সাবমিট (AC3) কোর-টেস্ট
// AC1: রিফ্রেশ/বন্ধ-রিকভারি · AC2: প্রতি-উত্তর অটো-সেভ (ইতিমধ্যে) · AC3: টাইমার-শেষে অটো-সাবমিট
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

/* ১ — টাইমার-লুপ: শূন্যে পৌঁছালে অটো-সাবমিট (বিদ্যমান কোর অক্ষত) */
t('tick: remaining<=0 হলে submitExam(true) কল', /if\(remaining<=0\)\{[\s\S]{0,120}?await submitExam\(true\)/.test(H));
t('tick: status!==running হলে লুপ-থামে', /if\(!ActiveExam \|\| ActiveExam\.status!=='running'\)\{ clearExamTimers\(\); return; \}/.test(H));
t('timerVisualClass (30s danger / 120s warn) অক্ষত', H.includes('if(remaining<=30) return \'timer-danger\';') && H.includes('if(remaining<=120) return \'timer-warn\';'));

/* ২ — গ্যাপ-১ ফিক্স: exact-এন্ডটাইম ব্যাকআপ-টাইমার + থ্রটল-ওয়েক */
t('scheduleExamExpiry: endTime-নির্ভর setTimeout (হাইড-ট্যাব-প্রুফ)', /function scheduleExamExpiry\(\)\{[\s\S]{0,200}?Math\.max\(0, ActiveExam\.endTime - Date\.now\(\)\) \+ 250/.test(H));
t('examTimerTick-এ scheduleExamExpiry পুনঃশিডিউল', H.includes('scheduleExamExpiry();') && /async function examTimerTick/.test(H));
t('ক্লিয়ার-ফাংশন: interval+expiry উভয় clearExamTimers', H.includes('function clearExamTimers(){ clearInterval(timerHandle);') && H.includes('clearTimeout(timerExpiryHandle);'));
t('wake-handlers: visibilitychange + pageshow + focus (এক-বাইন্ড গার্ড)', /document\.addEventListener\('visibilitychange', wake\)/.test(H) && /window\.addEventListener\('pageshow', wake\)/.test(H) && /window\.addEventListener\('focus', wake\)/.test(H) && /if\(timerWakeBound\) return;/.test(H));
t('wake: document.hidden হলে না-চালানো (ব্যাকগ্রাউন্ড-গার্ড)', /if\(document\.hidden\) return;/.test(H));

/* ৩ — গ্যাপ-২ ফিক্স: submitExam fail-safe (retry + আনলক) */
t('submitExam: try-ব্লকে মূল পথ (isSubmitting=true-র পরে)', /e\.isSubmitting=true;\s*\n\s*const examId=e\.id;\s*\n\s*clearExamTimers\(\);\s*\n\s*try \{/.test(H));
t('submitExam: catch-এ isSubmitting আনলক', /catch\(submitErr\)\{[\s\S]{0,220}?e\.isSubmitting=false;/.test(H));
t('retry: ব্যাকঅফ 1.5s×2^n, সর্বোচ্চ 30s, সর্বোচ্চ ৬-বার', H.includes('const waitMs=Math.min(30000, Math.pow(2,submitRetryAttempt-1)*1500);') && H.includes('submitRetryAttempt<6'));
t('retry: examId-গার্ড (নতুন পরীক্ষায় পুরনো-retry জমা পড়বে না)', /cur\.id===examId && cur\.status==='running'/.test(H));
t('retry-নোটিশ: toast বার্তা (ব্যবহারকারী-ইনফর্মড)', H.includes('সেকেন্ডে আবার চেষ্টা হবে') && H.includes('পরীক্ষা সংরক্ষিত আছে'));
t('সফল-সাবমিটে retry-কাউন্টার রিসেট', /await loadCache\(\);\s*\n\s*submitRetryAttempt=0;/.test(H));

/* ৪ — গ্যাপ-৩ ফিক্স: টাইমার-শেষে উত্তর-লক */
t('tick: remaining<=0 হলে timeExpired=true (লক-ফ্ল্যাগ)', /if\(!ActiveExam\.timeExpired\) ActiveExam\.timeExpired=true;/.test(H));
t('selectMockAnswer: timeExpired হলে উত্তর-গ্রহণ নেই', /async function selectMockAnswer\(qid,idx\)\{[\s\S]{0,120}?if\(e\.timeExpired\) return;/.test(H));
t('skipMock: timeExpired হলে skip নেই', /function skipMock\(\)\{[\s\S]{0,80}?if\(e\.timeExpired\) return;/.test(H));
t('mock-তৈরি: timeExpired:false প্রাথমিক-মান', /status:'running', isSubmitting:false, timeExpired:false, configuration:/.test(H));

/* ৫ — boot-পথ: মেয়াদ-উত্তীর্ণ পরীক্ষা অটো-সাবমিট অক্ষত + try/catch-প্রুফ */
t('boot: resumable-মেয়াদ শেষ হলে submitExam(true) + try/catch', /computeRemaining\(resumable\)<=0\)\{[\s\S]{0,140}?try\{ await submitExam\(true\); \} catch\(submitErr\)/.test(H));
t('boot: Resume-মোডাল + discard/resume পথ অক্ষত', H.includes('Resume Active Exam?') && H.includes('function resumeActiveExam()') && H.includes('function discardActiveExam()'));
t('discardActiveExam: retry-টাইমার ক্লিয়ার', /async function discardActiveExam\(\)\{\s*\n\s*clearTimeout\(submitRetryHandle\);/.test(H));

/* ৬ — ভার্সন-ট্র্যাকিং v189 */

t('sw BUILD_ID current shell', SW.includes("const BUILD_ID = 'v364-sky-goal'"));
t('index sw-marker current shell', H.includes("const expectedSwVersion = 'v364-sky-goal'"));

console.log(`\nP08-AC3: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
