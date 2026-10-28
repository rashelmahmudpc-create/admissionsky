// P11 — DASHBOARD v2 (ছবি-অনুযায়ী ১৪ মডিউল) ভেরিফিকেশন-টেস্ট (v195)
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const V2 = readFileSync('dashboard-v2.js', 'utf8');
const CSS = readFileSync('dashboard-v2.css', 'utf8');

/* ১ — ফাইল-লোড + ক্যাশ-কী */
t('dashboard-v2.js defer-লোড (?v=dash2)', H.includes('<script defer src="./dashboard-v2.js?v=dash2f18-chrome"></script>'));
t('dashboard-v2.css link (?v=dash2)', H.includes('<link rel="stylesheet" href="./dashboard-v2.css?v=dash2f13-theme">'));
t('sw APP_SHELL-এ dashboard-v2 (js+css)', SW.includes("'./dashboard-v2.js?v=dash2f18-chrome'") && SW.includes("'./dashboard-v2.css?v=dash2f13-theme'"));

t('sw BUILD_ID v364-sky-goal', SW.includes("const BUILD_ID = 'v364-sky-goal'"));
t('index sw-marker v348', H.includes("const expectedSwVersion = 'v364-sky-goal'") && H.includes('admission-hub-shell-v364-sky-goal'));

/* ২ — ১৪ মডিউল (মালিকের নতুন ডিজাইন: Scholar Dashboard 3) */
t('১ Personal Header (avatar+তারিখ+🔔)', V2.includes('id="greet"') && V2.includes('id="today"') && V2.includes('id="themeBtn"') && V2.includes('iconbtn'));
t('২ Smart Daily Mission (done/total MCQ + Continue + chips)', V2.includes('s-mission') && V2.includes('mCnt') && V2.includes('Continue') && V2.includes('MCQ'));
t('৩ Streak Card (7-day dots + badge)', V2.includes('s-streak') && V2.includes('days7') && V2.includes('Day Badge'));
t('৪ Today’s Performance (Solved/Correct/Wrong + Time + Mastery)', V2.includes('stats') && V2.includes('Mastery') && V2.includes('timeTxt') && V2.includes('data-count="stats.solved"'));
t('৫ Study Insight (mastery note + সৎ বার্তা)', V2.includes('mastNote') && V2.includes('mastBar'));
t('৬ Continuous Learning (প্রগ্রেস-বার + চলমান কোর্স)', V2.includes('courseBar') && V2.includes('চলমান কোর্স'));
t('৭ Command Center (Quick/Mock/Mistakes/Revision + আরও টুল)', V2.includes('toolGroups') && V2.includes('tool.quick') && V2.includes('tool.mistakes') && V2.includes('tool.revision'));
t('৮ Performance Graph (SVG লাইন-চার্ট + ৭-দিন)', V2.includes('perfSvg') && V2.includes('<svg') && V2.includes('perfHasData'));
t('৯ Weakness Radar (Topic-wise Accuracy + রঙিন বার)', V2.includes('radarFull') && V2.includes('wlist') && V2.includes('সবচেয়ে দুর্বল'));
t('১০ Admission Goal (বিশ্ববিদ্যালয় + Days Left + ⚙-বদল)', V2.includes('goalDays') && V2.includes('goalUni') && V2.includes('dv2EditGoal'));
t('১১ 90-Day Roadmap (৯০ দিনের প্ল্যান)', V2.includes('৯০ দিনের প্ল্যান') && V2.includes('roadmap.create'));
t('১২ Study Tools (Notes/Vocabulary/Dictionary/Search — Problem Solver বাদ)', V2.includes('tool.notes') && V2.includes('tool.vocab') && V2.includes('tool.dict') && V2.includes('tool.search') && !V2.includes('Problem Solver'));
t('১৩ Bottom Nav 4 core tabs (Home/Bank/Exam/Profile; AI → dashboard Command Center, History → Exam-এর ভিতরে)', (() => { const nav = (H.match(/const NAV_TABS=\[[\s\S]*?\];/) || [''])[0]; return /key:'dashboard'[\s\S]*key:'question-bank'[\s\S]*key:'exam'[\s\S]*key:'my-profile'/.test(nav) && !nav.includes("key:'ai'") && !nav.includes("key:'history'") && (nav.match(/\{key:/g) || []).length === 4; })() && !H.includes("key:'profile'") && !H.includes("key:'ai-chat'"));
t('১৪ মূল অ্যাপের AI Assistant script/dashboard-এন্ট্রি/direct route চালু (floating FAB নেই)', H.includes('ai-agent-chat.js?v=agent-f1-ui-skyv13') && !H.includes('juju-floating') && H.includes("if(p==='ai'){ if(window.renderAiAgentPage)") && V2.includes("'nav.ai'") && V2.includes("go('ai')"));
t('পুরনো-ড্যাশ-সম্পূর্ণ-বিলুপ্ত (মালিক-নির্দেশ ২০২৬-০৯-০৭): renderV2-এ previous()/intel-ক্যাপচার-নেই + dv2Cleanup-পরিচ্ছন্নতা', !V2.includes('data-dv2-phase5') && !V2.includes('intel = el.outerHTML') && V2.includes('function dv2Cleanup') && V2.includes('[data-phase5-dashboard],[data-phase34-dashboard]') && !/previous\(\);[\s\S]{0,300}data-phase5-dashboard/.test(V2));

/* ৩ — ডেটা-সততা: CACHE-ভিত্তিক, কোনো ফেক সংখ্যা নয় */
t('সব-সংখ্যা CACHE-সূত্র (dailyStats/examResults/questions)', V2.includes('if (window.CACHE) return window.CACHE;') && V2.includes('examResults') && V2.includes('dailyStats'));
t('শূন্য-অবস্থা-বার্তা (সৎ, কোনো বানানো-সংখ্যা নয়)', V2.includes('এখনো ডেটা নেই') && V2.includes('লিডারবোর্ড এখনো চালু হয়নি') && V2.includes('এখনো কোনো পরীক্ষার উত্তর নেই') && V2.includes('এখনো কোনো কোর্স শুরু করোনি'));
t('অফলাইন: dashboard-v2.js-এ কোনো fetch/XHR/https-কল নেই', !/fetch\(|XMLHttpRequest|https:\/\//.test(V2));
t('নতুন DB-স্কিমা নেই (idb-স্টোর-স্পর্শ নয়)', !/dbCreateStore|objectStore\(/.test(V2) || /dbPut\('settings'\)/.test(V2));
t('goal-ডিফল্ট-স্যাম্পল + সেটিংস-সেভ (dv2SaveGoal)', V2.includes('dv2SaveGoal') && V2.includes("dbPut('settings'"));
t('সাপ্তাহিক-নোট: নিয়ম-ভিত্তিক (দিন-সংখ্যা + লক্ষ্য-শতাংশ)', V2.includes("weekNote')") && V2.includes('দিন</b> পড়েছ') && V2.includes('লক্ষ্যের'));
/* ৪ — ইঞ্জিন-অক্ষত (additive-chain + গার্ড) */
t('renderDashboard override: path-গার্ড + previous-ডেলিগেট', /if \(path !== 'dashboard'[\s\S]{0,120}typeof previous === 'function'\) return previous\.apply/.test(V2));
t('renderShell-রেন্ডার + no-renderShell-ফলব্যাক', V2.includes("typeof window.renderShell === 'function'") && V2.includes('renderShell(html'));
t('__dashboardV2Installed গার্ড (দ্বিগুণ-ইনস্টল নয়)', V2.includes('window.__dashboardV2Installed'));
t('dv2AllTools: পুরনো ১১+ টুল No-loss (Bank/Progress/Vocab/Study-tools)', V2.includes("go('question-bank')") && V2.includes("go('progress')") && V2.includes("go('vocabulary-master')") && V2.includes("go('study-tools')"));

/* ৫ — রিগ্রেশন লক (অর্থাৎ আগের পোস্টার-কি অক্ষত) */
// Anchored on the path boundary so welcome-onboarding.js/css (live assets) do not
// trip a guard meant for the retired onboarding.js/css.
t('retired account/onboarding assets are absent from index and shell', !/premium-auth|auth-svg|(?<![\w-])onboarding\.js|(?<![\w-])onboarding\.css|curriculum-config/.test(H + SW));
t('performance-hardening.js?v=2 remains deferred outside lean shell', H.includes('<script defer src="performance-hardening.js?v=2"></script>') && !SW.includes("'./performance-hardening.js?v=2'"));

/* ৬ — CSS-শৈলী-উপস্থিতি */
t('দৃশ্য-কোর: dv2-card/dv2-mission/dv2-ring/dv2-tools/bottomnav-রিস্টাইল', CSS.includes('.dv2-card') && CSS.includes('.dv2-mission') && CSS.includes('.dv2-ring') && CSS.includes('.dv2-tools') && CSS.includes('.bottomnav'));
t('মোবাইল-ফার্স্ট: dv2-root এক-কলাম flex + media-কোয়েরি', CSS.includes('.dv2-root') && CSS.includes('@media(min-width:720px)'));
t('কোনো এক্সটার্নাল ফন্ট/ইমেজ-URL নেই', !/url\(https?:|@import/.test(CSS));

console.log(`\nP11-DASHBOARD-V2: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
