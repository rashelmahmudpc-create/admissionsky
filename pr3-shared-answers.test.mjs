// PR-3 (owner 2026-10-17): Sky shared answers. Common textbook questions get the same
// reviewed answer for everyone, in the app: no server call, no AI limit. Only a very
// close match is used; "আরো বিস্তারিত" sends the question to the AI.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { try { c() ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)); } catch (e) { fail++; console.log('  ✗', n, '→', e && e.message); } };
const FILES = ['sky-faq-bn.js', 'sky-faq-en.js', 'sky-faq-sci.js', 'sky-faq-gk.js'];
for (const f of [...FILES, 'sky-faq.js', 'sky-smalltalk.js']) await import('./' + f);
const F = globalThis.SkyFAQ, S = globalThis.SkySmallTalk;
const D = globalThis.SkyFAQData;
const id = (q) => (F.match(q) || {}).id || null;

// 2026-10-17: owner cleared every stored answer; new ones will be added later.
t('PR3-১. the stored answer bank is empty, and nothing matches while it is empty', () =>
  Array.isArray(D) && D.length === 0 && ['সমাস কী', 'what is noun', 'পদ্মা সেতু'].every(q => F.match(q) === null));
// Matcher checks below run on a small test-only list (never shipped).
const fx = (id, ...k) => D.push({ id, k, a: 't' });
fx('bn-samas', 'সমাস', 'samas'); fx('bn-sandhi', 'সন্ধি', 'sandhi'); fx('bn-karok', 'কারক', 'karok');
fx('sci-newton1', 'নিউটনের প্রথম সূত্র', 'জড়তার সূত্র', "newton's first law", 'newton first law');
fx('sci-force', 'বল', 'force'); fx('gk-padma-bridge', 'পদ্মা সেতু', 'padma bridge');
fx('en-noun', 'noun', 'nouns'); fx('en-tense', 'tense', 'tenses'); fx('en-tag', 'tag question', 'question tag');
fx('gk-gdp', 'জিডিপি', 'gdp'); fx('bio-photosynthesis', 'সালোকসংশ্লেষণ', 'photosynthesis');
t('PR3-২. no topic name is empty after removing question words, none is shared by two entries', () => {
  const seen = new Map();
  for (const e of D) for (const k of e.k) { const c = F._core(k); if (!c) return false; if (seen.has(c) && seen.get(c) !== e.id) return false; seen.set(c, e.id); }
  return true;
});
t('PR3-৩. the four data files ship no answers', () =>
  FILES.every(f => !/\{\s*id:/.test(readFileSync('./' + f, 'utf8'))));
t('PR3-৪. common Bengali forms match', () =>
  id('সমাস কী?') === 'bn-samas' && id('সমাস কাকে বলে') === 'bn-samas' && id('সমাসের সংজ্ঞা দাও') === 'bn-samas' &&
  id('সন্ধি কি') === 'bn-sandhi' && id('কারক কত প্রকার') === 'bn-karok' && id('নিউটনের প্রথম সূত্র কী?') === 'sci-newton1' &&
  id('বল কী') === 'sci-force' && id('পদ্মা সেতু') === 'gk-padma-bridge');
t('PR3-৫. English and Banglish forms match', () =>
  id('What is noun?') === 'en-noun' && id('tense kake bole') === 'en-tense' && id('tag question ki') === 'en-tag' &&
  id('what is gdp') === 'gk-gdp' && id("Newton's first law") === 'sci-newton1');
t('PR3-৬. a small typo in a long topic still matches', () => id('সালোকসংশ্লেশন কী') === 'bio-photosynthesis');
t('PR3-৭. anything more than the topic goes to the AI', () =>
  [ 'সমাসের ১০টা উদাহরণ দাও', 'সমাস ও সন্ধি কী', 'সন্ধি বিচ্ছেদ করো বিদ্যালয়', 'জাতিসংঘ কবে প্রতিষ্ঠিত হয়',
    'সমাস কী — আরো বিস্তারিত বুঝিয়ে বলো', 'আমার দুর্বল টপিক কোনগুলো', 'x'.repeat(90), 'সমাস কী\nসন্ধি কী', '' ].every(q => id(q) === null));
t('PR3-৮. small talk is not a shared answer (PR-2 bank answers it first)', () =>
  ['hi', 'hello', 'ধন্যবাদ', 'তুমি কে'].every(q => id(q) === null && S.kind(q) !== ''));
const chat = readFileSync('./ai-agent-chat.js', 'utf8');
t('PR3-৯. chat: shared answer checked after small talk and before any server work', () => {
  const a = chat.indexOf('ST.replyMsg('), b = chat.indexOf('window.SkyFAQ.match(t)'), c = chat.indexOf("const holder = { role: 'ai', text: '', ts: Date.now(), pending: true");
  return a > 0 && b > a && c > b && /faq: faq\.id/.test(chat);
});
t('PR3-১০. chat: bubble shows the note and an "আরো বিস্তারিত" chip that goes to the AI', () =>
  /function faqNote\(m\)/.test(chat) && /\+ faqNote\(m\) \+ contactNote\(m\) \+ acts/.test(chat) && /data-q="' \+ esc\(more\)/.test(chat) &&
  /আরো বিস্তারিত বুঝিয়ে বলো/.test(chat) && /#app\.sky \.faqm\{/.test(chat));
const html = readFileSync('./index.html', 'utf8'), sw = readFileSync('./sw.js', 'utf8');
t('PR3-১১. index.html loads and sw.js precaches all five files', () =>
  ['sky-faq.js', ...FILES].every(f => html.includes('<script type="application/x-ah-idle" data-ah-src="./' + f + '?v=faq1"></script>') && html.includes('"./' + f + '?v=faq1"') && sw.includes("'./" + f + "?v=faq1'") && sw.includes('"./' + f + '?v=faq1": "')));
console.log(`\nPR-3 shared answers: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
