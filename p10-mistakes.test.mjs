// P10 — MISTAKES (ব্যবধান-বন্ধ: Mastered-নিয়ন্ত্রণ + ফিল্টার + কভারেজ) ভেরিফিকেশন-টেস্ট
// নোট: Mistake Bank 2.0 + Smart Mistake Book (mistake-analysis.js) + রেকর্ডিং আগে-থেকেই ছিল;
// এই-সুট দেখায় কী আছো (রিগ্রেশন) + কী যোগ হলো (v194): setMistakeMastered / Mastered-ফিল্টার-কাউন্ট।
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const MA = readFileSync('mistake-analysis.js', 'utf8');
const MN = readFileSync('mistake-note-icon.js', 'utf8');
const V2 = readFileSync('dashboard-v2.js', 'utf8');

/* ১ — v194: Mastered-নিয়ন্ত্রণ UI (নতুন) */
t('setMistakeMastered ফাংশন (window-level)', H.includes('window.setMistakeMastered=async function(qid,val)'));
t('mastered-আপডেট: m.mastered + revisionStatus (mastered/pending) + masteredAt', /m\.mastered=val===true;m\.revisionStatus=m\.mastered\?'mastered':'pending';if\(m\.mastered\)m\.masteredAt=Date\.now\(\);else delete m\.masteredAt;/.test(H));
/* The toast copy joined "শিখে গেছি" and "Mastered" with a comma after the
   shipped-copy typography pass (29a1ac7); accept any single separator. */
t('mastered-সেভ: dbPut + CACHE-refresh + toast + re-render', /await dbPut\('mistakes',m\);CACHE\.mistakes=await dbGetAll\('mistakes'\);toast\(m\.mastered\?'✅ শিখে গেছি[^']*Mastered':'↩️ আবার অনুশীলনে'\);render\(\);/.test(H));
t('Mastered-টগল বাটন card-এ (✅ শিখে গেছি / ↩️ আবার শিখি)', /setMistakeMastered\('\$\{r\.q\.id\}',\$\{!r\.m\.mastered\}\)/.test(H) && H.includes('✅ শিখে গেছি') && H.includes('↩️ আবার শিখি'));
t('MASTERED ব্যাজ (mint-pill)', /✓ MASTERED/.test(H) && /r\.m\.mastered\?`<span class="pill" style="background:var\(--mint\)/.test(H));

/* ২ — v194: ফিল্টার + কাউন্ট */
t('ফিল্টার-চিপ: Needs Review + Mastered যোগ', H.includes("['pending','Needs Review']") && H.includes("['mastered','Mastered']"));
t('ফিল্টার-লজিক: mastered/pending শাখা', /filter==='mastered'\?r\.m\.mastered===true:filter==='pending'\?r\.m\.mastered!==true:true\)/.test(H));
t('হেডার-কাউন্ট: pending/mastered', /pendingCt=rows\.filter\(r=>r\.m\.mastered!==true\)\.length, masteredCt=rows\.length-pendingCt/.test(H) && H.includes('${pendingCt} pending'));

/* ৩ — রিগ্রেশন: Bank 2.0-কোর অক্ষত */
t('Mistake Bank 2.0 টাইটেল + subtitle', H.includes('Mistake Bank 2.0') && H.includes('Revision System'));
t('mistakeRows(): attempts/wrong/acc/priority-ডেরাইভ', /function mistakeRows\(\)\{return CACHE\.mistakes\.map\(m=>/.test(H) && /priority=wrong>=5\|\|acc<50\?'high':wrong>=2\|\|acc<75\?'medium':'low'/.test(H));
t('ফিল্টার-সেট: all/today/frequent/recent/critical/weak (+নতুন ২)', H.includes("['critical','Critical']") && H.includes("['weak','Weak Topic']"));
t('card-অ্যাকশন: Review/Flash Test/Bookmark/Remove', H.includes("startQuestionPractice(['${r.q.id}'])") && H.includes("beginExamFromPool([CACHE.questions.find(q=>q.id==='${r.q.id}')],'flash')") && H.includes("removeMistake('${r.m.id}')"));
t('removeMistake: dbDel + CACHE-refresh + toast', H.includes("removeMistake=async function(id){await dbDel('mistakes',id);CACHE.mistakes=await dbGetAll('mistakes');toast('Removed from Mistake Bank');render();};"));
t('Practice-My-Mistakes মোডাল (10/20/50/100) + startMistakeCount', H.includes('openMistakePracticeModal') && H.includes('[10,20,50,100].map'));
t('startMistakeExam(mock/flash) → beginExamFromPool', /window\.startMistakeExam=async function\(mode\)\{startMistakeCount/.test(H) && H.includes('beginExamFromPool(pool,mode)'));
t('exam-setup-এ source: wrong (Mistakes) রুট+ব্যাজ', H.includes("['wrong','Mistakes']"));
t('Dashboard-এ ❌ Mistakes টাইল (নতুন-ড্যাশবোর্ডে — পুরোনো-ড্যাশ-মৃত)', H.includes('renderMistakes') && H.includes("if(p==='mistakes') return renderMistakes();") && V2.includes("go('mistakes')"));

/* ৪ — রেকর্ডিং-পথ (exam-submit + explorer + flash) */
t('exam-submit: snapshot-wrong → enrichMistakeRecord + wrongCount++ + status UNRESOLVED', /for\(const s of result\.snapshot\.filter\(x=>x\.status==='wrong'\)\)/.test(H) && /m\.status='UNRESOLVED'\s*;?\s*m\.mastered=false/.test(H) && /m\.wrongCount=beforeWrong\+1;/.test(H));
t('explorer-প্র্যাকটিস-ভুল → mistakes-রেকর্ড', /let m=CACHE\.mistakes\.find\(x=>x\.questionId===row\.qid\);if\(!m\)m=\{id:uid\(\),questionId:row\.qid,wrongCount:0,revisionStatus:'pending',mastered:false\};/.test(H));
t('flash/result-পথ → enrichMistakeRecord (revisionStatus+mastered-অক্ষত)', /m\.revisionStatus=m\.revisionStatus\|\|'pending'/.test(H) && /m\.mastered=m\.mastered===true/.test(H));
t('Settings: Delete Mistakes (dbClear)', H.includes("dbClear('mistakes')") && H.includes('Delete Mistakes'));

/* ৫ — Smart Mistake Book (mistake-analysis.js) লোডেড + API */
t('mistake-analysis.js deferred in production HTML (optional, outside lean shell)', H.includes('<script defer src="mistake-analysis.js?v=p10-v2"></script>') && !SW.includes("'./mistake-analysis.js?v=p10-v2'"));
t('MA publicApi এক্সপোজড (window.MA)', MA.includes('window.MA = publicApi') && MA.includes('publicApi'));
t('ভুল-খাতা localStorage-key + toAgentPayload', MA.includes("'mistake-analysis-notebook-v1'") && MA.includes('toAgentPayload'));
t('mistake-note-icon.js deferred in production HTML (optional, outside lean shell)', H.includes('mistake-note-icon.js?v=16-aiex') && !SW.includes("'./mistake-note-icon.js?v=16-aiex'"));
t('note-icon: openQuestionNoteEditor ইন্টিগ্রেশন', MN.includes('openQuestionNoteEditor') && MN.includes('__mistakeNoteIconInstalled'));

/* ৬ — ভার্সন v194 */

t('sw BUILD_ID current shell', SW.includes("const BUILD_ID = 'v364-sky-goal'"));
t('index sw-marker current shell', H.includes("const expectedSwVersion = 'v364-sky-goal'"));

console.log(`\nP10-MISTAKES: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
